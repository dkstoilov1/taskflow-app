[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $env:TEMP ('taskflow-db-helper-tests-' + [Guid]::NewGuid().ToString('N'))
$fakeBin = Join-Path $testRoot 'fake-bin'
$alternateBin = Join-Path $testRoot 'alternate-bin'
$powerShellDirectory = Join-Path $testRoot 'powershell-location'
$dotNetDirectory = Join-Path $testRoot 'dotnet-location'
$backupHelper = Join-Path $PSScriptRoot 'Backup-TaskFlowDatabase.ps1'
$restoreHelper = Join-Path $PSScriptRoot 'Restore-TaskFlowBackup.ps1'
$oldLocation = Get-Location
$oldDotNetDirectory = [System.Environment]::CurrentDirectory
$oldPath = $env:PATH
$environmentNames = @(
    'TASKFLOW_FAKE_DUMP_MODE',
    'TASKFLOW_FAKE_DUMP_TARGET',
    'TASKFLOW_FAKE_DUMP_LOG',
    'TASKFLOW_FAKE_RESTORE_MODE',
    'TASKFLOW_FAKE_CREATEDB_LOG',
    'TASKFLOW_FAKE_RESTORE_LOG'
)
$oldEnvironment = @{}
foreach ($name in $environmentNames) {
    $oldEnvironment[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
}
$cleanupFunctionInstalled = $false

function Assert-True {
    param([bool] $Condition, [string] $Message)
    if (-not $Condition) {
        throw $Message
    }
}

function Assert-BytesEqual {
    param([byte[]] $Actual, [byte[]] $Expected, [string] $Message)
    if ($Actual.Length -ne $Expected.Length) {
        throw $Message
    }
    for ($index = 0; $index -lt $Actual.Length; $index++) {
        if ($Actual[$index] -ne $Expected[$index]) {
            throw $Message
        }
    }
}

function Assert-NoOwnedTemporaryFiles {
    param([string] $Directory)
    $files = [System.IO.Directory]::GetFiles($Directory, '.taskflow-backup-*.tmp')
    if ($files.Length -ne 0) {
        throw "Expected no helper-owned temporary backup files; found $($files.Length)."
    }
}

try {
    New-Item -ItemType Directory -Path $fakeBin, $alternateBin, $powerShellDirectory, $dotNetDirectory -Force | Out-Null
    $env:TASKFLOW_FAKE_DUMP_LOG = Join-Path $testRoot 'pg-dump-calls.log'
    $env:TASKFLOW_FAKE_CREATEDB_LOG = Join-Path $testRoot 'createdb-targets.log'
    $env:TASKFLOW_FAKE_RESTORE_LOG = Join-Path $testRoot 'pg-restore-targets.log'

    $pgDumpSource = @'
using System;
using System.IO;
public static class FakePgDump {
    public static int Main(string[] args) {
        int fileIndex = Array.IndexOf(args, "--file");
        if (fileIndex < 0 || fileIndex + 1 >= args.Length) return 90;
        string log = Environment.GetEnvironmentVariable("TASKFLOW_FAKE_DUMP_LOG");
        File.AppendAllText(log, "called\n");
        string output = args[fileIndex + 1];
        File.WriteAllBytes(output, new byte[] { 0, 255, 1, 128, 42, 0 });
        string mode = Environment.GetEnvironmentVariable("TASKFLOW_FAKE_DUMP_MODE");
        if (mode == "race") {
            string target = Environment.GetEnvironmentVariable("TASKFLOW_FAKE_DUMP_TARGET");
            using (FileStream stream = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                byte[] targetBytes = new byte[] { 77, 0, 88, 255 };
                stream.Write(targetBytes, 0, targetBytes.Length);
            }
        }
        return mode == "failure" ? 23 : 0;
    }
}
'@
    $createdbSource = @'
using System;
using System.IO;
public static class FakeCreatedb {
    public static int Main(string[] args) {
        if (args.Length == 0) return 91;
        File.AppendAllText(Environment.GetEnvironmentVariable("TASKFLOW_FAKE_CREATEDB_LOG"), args[args.Length - 1] + "\n");
        return 0;
    }
}
'@
    $pgRestoreSource = @'
using System;
using System.IO;
public static class FakePgRestore {
    public static int Main(string[] args) {
        int listIndex = Array.IndexOf(args, "--list");
        if (listIndex >= 0) {
            if (Environment.GetEnvironmentVariable("TASKFLOW_FAKE_RESTORE_MODE") == "invalid") return 19;
            return File.Exists(args[args.Length - 1]) ? 0 : 20;
        }
        int databaseIndex = Array.IndexOf(args, "--dbname");
        if (databaseIndex < 0 || databaseIndex + 1 >= args.Length) return 92;
        File.AppendAllText(Environment.GetEnvironmentVariable("TASKFLOW_FAKE_RESTORE_LOG"), args[databaseIndex + 1] + "\n");
        return 0;
    }
}
'@
    $unexpectedClientSource = @'
using System;
public static class UnexpectedClient {
    public static int Main(string[] args) {
        Console.Error.WriteLine("A later PATH entry was invoked unexpectedly.");
        return 97;
    }
}
'@
    Add-Type -TypeDefinition $pgDumpSource -OutputAssembly (Join-Path $fakeBin 'pg_dump.exe') -OutputType ConsoleApplication -ErrorAction Stop
    Add-Type -TypeDefinition $createdbSource -OutputAssembly (Join-Path $fakeBin 'createdb.exe') -OutputType ConsoleApplication -ErrorAction Stop
    Add-Type -TypeDefinition $pgRestoreSource -OutputAssembly (Join-Path $fakeBin 'pg_restore.exe') -OutputType ConsoleApplication -ErrorAction Stop
    Add-Type -TypeDefinition $unexpectedClientSource -OutputAssembly (Join-Path $alternateBin 'pg_dump.exe') -OutputType ConsoleApplication -ErrorAction Stop
    Copy-Item -LiteralPath (Join-Path $alternateBin 'pg_dump.exe') -Destination (Join-Path $alternateBin 'pg_restore.exe')
    Copy-Item -LiteralPath (Join-Path $alternateBin 'pg_dump.exe') -Destination (Join-Path $alternateBin 'createdb.exe')

    $env:PATH = $fakeBin + ';' + $alternateBin + ';' + $oldPath
    foreach ($client in @('pg_dump', 'pg_restore', 'createdb')) {
        $candidates = @(Get-Command $client -CommandType Application)
        Assert-True ($candidates.Count -ge 2) "Expected multiple PATH candidates for $client."
        Assert-True ($candidates[0].Source -eq (Join-Path $fakeBin ($client + '.exe'))) "Unexpected first PATH candidate for $client."
        Assert-True ($candidates[1].Source -eq (Join-Path $alternateBin ($client + '.exe'))) "Unexpected second PATH candidate for $client."
    }
    Set-Location $powerShellDirectory
    [System.Environment]::CurrentDirectory = $dotNetDirectory
    $env:TASKFLOW_FAKE_DUMP_MODE = 'success'
    $relativeArchive = '.\relative-backup.dump'
    & $backupHelper -ArchivePath $relativeArchive | Out-Null
    $relativePathInPowerShellLocation = Join-Path $powerShellDirectory 'relative-backup.dump'
    Assert-True (Test-Path -LiteralPath $relativePathInPowerShellLocation) 'Relative archive path did not resolve from the PowerShell location.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $dotNetDirectory 'relative-backup.dump'))) 'Relative archive path incorrectly used the .NET current directory.'
    Assert-BytesEqual ([System.IO.File]::ReadAllBytes($relativePathInPowerShellLocation)) ([byte[]](0, 255, 1, 128, 42, 0)) 'Custom-format archive bytes changed.'
    Assert-NoOwnedTemporaryFiles $powerShellDirectory
    Write-Output 'PASS: backup preserves binary bytes and resolves relative paths from the PowerShell location.'

    $existingArchive = Join-Path $powerShellDirectory 'existing.dump'
    [System.IO.File]::WriteAllBytes($existingArchive, [byte[]](4, 5, 6))
    $dumpCallsBefore = [System.IO.File]::ReadAllLines($env:TASKFLOW_FAKE_DUMP_LOG).Length
    $existingRejected = $false
    try {
        & $backupHelper -ArchivePath $existingArchive | Out-Null
    }
    catch {
        $existingRejected = $_.Exception.Message -like '*Refusing to overwrite an existing backup*'
    }
    Assert-True $existingRejected 'Backup helper did not reject an existing destination.'
    Assert-BytesEqual ([System.IO.File]::ReadAllBytes($existingArchive)) ([byte[]](4, 5, 6)) 'Existing destination was modified.'
    Assert-True ([System.IO.File]::ReadAllLines($env:TASKFLOW_FAKE_DUMP_LOG).Length -eq $dumpCallsBefore) 'pg_dump ran despite an existing target.'
    Write-Output 'PASS: pre-existing backup destination is preserved and pg_dump is not invoked.'

    $env:TASKFLOW_FAKE_DUMP_MODE = 'failure'
    $failedArchive = Join-Path $powerShellDirectory 'failed.dump'
    $dumpFailure = $null
    try {
        & $backupHelper -ArchivePath $failedArchive | Out-Null
    }
    catch {
        $dumpFailure = $_.Exception.Message
    }
    Assert-True ($dumpFailure -like '*pg_dump failed with exit code 23*') 'pg_dump failure was not surfaced.'
    Assert-True (-not (Test-Path -LiteralPath $failedArchive)) 'Failed backup published a destination file.'
    Assert-NoOwnedTemporaryFiles $powerShellDirectory
    Write-Output 'PASS: pg_dump failure is surfaced and its temporary file is cleaned.'

    $env:TASKFLOW_FAKE_DUMP_MODE = 'race'
    $racingArchive = Join-Path $powerShellDirectory 'racing.dump'
    $env:TASKFLOW_FAKE_DUMP_TARGET = $racingArchive
    $raceFailure = $false
    try {
        & $backupHelper -ArchivePath $racingArchive | Out-Null
    }
    catch {
        $raceFailure = $true
    }
    Assert-True $raceFailure 'Backup helper unexpectedly replaced a destination created during pg_dump.'
    Assert-BytesEqual ([System.IO.File]::ReadAllBytes($racingArchive)) ([byte[]](77, 0, 88, 255)) 'Racing destination file was overwritten.'
    Assert-NoOwnedTemporaryFiles $powerShellDirectory
    Write-Output 'PASS: destination created during pg_dump is preserved and only the helper temporary file is removed.'

    if (Test-Path Function:\global:Remove-Item) {
        throw 'Cannot inject cleanup failure because a global Remove-Item function already exists.'
    }
    $env:TASKFLOW_FAKE_DUMP_MODE = 'failure'
    $cleanupFailureMessage = $null
    function global:Remove-Item {
        throw 'injected cleanup failure'
    }
    $cleanupFunctionInstalled = $true
    try {
        & $backupHelper -ArchivePath (Join-Path $powerShellDirectory 'cleanup-failure.dump') | Out-Null
    }
    catch {
        $cleanupFailureMessage = $_.Exception.Message
    }
    Assert-True ($cleanupFailureMessage -like '*pg_dump failed with exit code 23*') 'Original pg_dump failure was not retained.'
    Assert-True ($cleanupFailureMessage -like '*injected cleanup failure*') 'Temporary-file cleanup failure was silently suppressed.'
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath Function:\global:Remove-Item -ErrorAction Stop
    $cleanupFunctionInstalled = $false
    foreach ($temporaryFile in [System.IO.Directory]::GetFiles($powerShellDirectory, '.taskflow-backup-*.tmp')) {
        [System.IO.File]::Delete($temporaryFile)
    }
    Write-Output 'PASS: cleanup failure is surfaced alongside the original pg_dump failure.'

    $restoreArchive = Join-Path $powerShellDirectory 'restore-source.dump'
    [System.IO.File]::WriteAllBytes($restoreArchive, [byte[]](10, 20, 30))
    $env:TASKFLOW_FAKE_RESTORE_MODE = 'valid'
    $restoreOutput = & $restoreHelper -ArchivePath $restoreArchive
    $targetMatch = [regex]::Match(($restoreOutput | Out-String), "taskflow_restore_[0-9]{8}_[0-9]{6}_[a-f0-9]{8}")
    Assert-True $targetMatch.Success 'Restore did not report its generated isolated database target.'
    $generatedRestoreDatabase = $targetMatch.Value
    $createdDatabases = [System.IO.File]::ReadAllLines($env:TASKFLOW_FAKE_CREATEDB_LOG)
    $restoredDatabases = [System.IO.File]::ReadAllLines($env:TASKFLOW_FAKE_RESTORE_LOG)
    Assert-True ($createdDatabases.Length -eq 1 -and $createdDatabases[0] -eq $generatedRestoreDatabase) 'createdb did not receive the generated isolated database name.'
    Assert-True ($restoredDatabases.Length -eq 1 -and $restoredDatabases[0] -eq $generatedRestoreDatabase) 'pg_restore did not target the generated isolated database.'
    Assert-True ($generatedRestoreDatabase -ne 'taskflow') 'Restore helper targeted the live database name.'
    Write-Output 'PASS: restore creates and targets only its generated isolated database.'
    Write-Output 'PASS: backup and restore use the first client executable when PATH contains multiple versions.'

    $invalidArchive = Join-Path $powerShellDirectory 'invalid-source.dump'
    [System.IO.File]::WriteAllBytes($invalidArchive, [byte[]](1, 2, 3))
    $createdCountBeforeInvalid = [System.IO.File]::ReadAllLines($env:TASKFLOW_FAKE_CREATEDB_LOG).Length
    $env:TASKFLOW_FAKE_RESTORE_MODE = 'invalid'
    $invalidArchiveFailure = $null
    try {
        & $restoreHelper -ArchivePath $invalidArchive | Out-Null
    }
    catch {
        $invalidArchiveFailure = $_.Exception.Message
    }
    Assert-True ($invalidArchiveFailure -like '*could not read the archive*') 'Invalid archive was not rejected.'
    Assert-True ([System.IO.File]::ReadAllLines($env:TASKFLOW_FAKE_CREATEDB_LOG).Length -eq $createdCountBeforeInvalid) 'Invalid archive caused a target database to be created.'
    Write-Output 'PASS: invalid archive is rejected before createdb or restore.'
}
finally {
    if ($cleanupFunctionInstalled) {
        Microsoft.PowerShell.Management\Remove-Item -LiteralPath Function:\global:Remove-Item -ErrorAction SilentlyContinue
    }
    Set-Location $oldLocation
    [System.Environment]::CurrentDirectory = $oldDotNetDirectory
    $env:PATH = $oldPath
    foreach ($name in $environmentNames) {
        [System.Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process')
    }
    if (Test-Path -LiteralPath $testRoot) {
        [System.IO.Directory]::Delete($testRoot, $true)
    }
}

Write-Output 'All fake PostgreSQL client regressions passed; no database or Docker was used.'
