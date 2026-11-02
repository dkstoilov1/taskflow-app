[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $Server = '127.0.0.1',

    [Parameter()]
    [ValidateRange(1, 65535)]
    [int] $Port = 5432,

    [Parameter()]
    [ValidatePattern('^[A-Za-z0-9_]+$')]
    [string] $Database = 'taskflow',

    [Parameter()]
    [ValidatePattern('^[A-Za-z0-9_]+$')]
    [string] $Username = 'taskflow',

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $ArchivePath = ("taskflow-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
)

$ErrorActionPreference = 'Stop'

$pgDump = Get-Command 'pg_dump' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $pgDump) {
    throw 'pg_dump was not found. Install PostgreSQL client tools compatible with the server, or add them to PATH.'
}

$currentLocation = Get-Location
if ($currentLocation.Provider.Name -ne 'FileSystem') {
    throw 'Run this helper from a filesystem location.'
}

$archivePathToResolve = $ArchivePath
if (-not [System.IO.Path]::IsPathRooted($archivePathToResolve)) {
    $archivePathToResolve = Join-Path -Path $currentLocation.ProviderPath -ChildPath $archivePathToResolve
}
$resolvedArchivePath = [System.IO.Path]::GetFullPath($archivePathToResolve)
$archiveDirectory = Split-Path -Parent $resolvedArchivePath
if (-not (Test-Path -LiteralPath $archiveDirectory -PathType Container)) {
    throw "Backup directory does not exist: $archiveDirectory"
}
if (Test-Path -LiteralPath $resolvedArchivePath) {
    throw "Refusing to overwrite an existing backup: $resolvedArchivePath"
}

$temporaryArchivePath = Join-Path -Path $archiveDirectory -ChildPath ('.taskflow-backup-{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
$ownsTemporaryArchive = $false

$arguments = @(
    '--host', $Server,
    '--port', [string] $Port,
    '--username', $Username,
    '--dbname', $Database,
    '--no-password',
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--file', $temporaryArchivePath
)

try {
    # Create an exclusive same-directory temporary file so only this invocation cleans it up.
    $temporaryFile = [System.IO.File]::Open(
        $temporaryArchivePath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    $ownsTemporaryArchive = $true
    $temporaryFile.Dispose()

    # pg_dump writes custom-format bytes directly; never pipe them through PowerShell text output.
    & $pgDump.Source @arguments
    $dumpExitCode = $LASTEXITCODE
    if ($dumpExitCode -ne 0) {
        throw "pg_dump failed with exit code $dumpExitCode."
    }

    $archive = Get-Item -LiteralPath $temporaryArchivePath -ErrorAction Stop
    if ($archive.Length -eq 0) {
        throw 'pg_dump reported success but produced an empty archive.'
    }

    # Same-directory File.Move is an atomic, no-replacement publication on supported filesystems.
    # If another process created the destination after the preflight check, this fails without
    # replacing it; the catch block only removes the temporary file created above.
    [System.IO.File]::Move($temporaryArchivePath, $resolvedArchivePath)
    $ownsTemporaryArchive = $false

    $publishedArchive = Get-Item -LiteralPath $resolvedArchivePath -ErrorAction Stop
    Write-Output ("Backup created: {0} ({1} bytes)." -f $resolvedArchivePath, $publishedArchive.Length)
}
catch {
    $backupError = $_
    if ($ownsTemporaryArchive -and [System.IO.File]::Exists($temporaryArchivePath)) {
        try {
            Remove-Item -LiteralPath $temporaryArchivePath -Force -ErrorAction Stop
        }
        catch {
            $cleanupError = $_
            throw ("Backup failed: {0} Cleanup of owned temporary archive '{1}' also failed: {2}" -f
                $backupError.Exception.Message,
                $temporaryArchivePath,
                $cleanupError.Exception.Message)
        }
    }
    throw $backupError
}
