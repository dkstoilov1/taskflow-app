[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $ArchivePath,

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string] $Server = '127.0.0.1',

    [Parameter()]
    [ValidateRange(1, 65535)]
    [int] $Port = 5432,

    [Parameter()]
    [ValidatePattern('^[A-Za-z0-9_]+$')]
    [string] $Username = 'taskflow'
)

$ErrorActionPreference = 'Stop'

$resolvedArchivePath = (Resolve-Path -LiteralPath $ArchivePath -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $resolvedArchivePath -PathType Leaf)) {
    throw "Backup archive is not a file: $resolvedArchivePath"
}

$pgRestore = Get-Command 'pg_restore' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $pgRestore) {
    throw 'pg_restore was not found. Install PostgreSQL client tools compatible with the server, or add them to PATH.'
}
$createdb = Get-Command 'createdb' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $createdb) {
    throw 'createdb was not found. Install PostgreSQL client tools compatible with the server, or add them to PATH.'
}

# Validate the archive before creating a database. The target name is generated here and
# intentionally cannot be supplied by the caller, so this script cannot target the live DB.
& $pgRestore.Source '--list' $resolvedArchivePath | Out-Null
$listExitCode = $LASTEXITCODE
if ($listExitCode -ne 0) {
    throw "pg_restore could not read the archive (exit code $listExitCode). No database was created."
}

$restoreDatabase = 'taskflow_restore_{0}_{1}' -f (Get-Date -Format 'yyyyMMdd_HHmmss'), ([Guid]::NewGuid().ToString('N').Substring(0, 8))
$createArguments = @(
    '--host', $Server,
    '--port', [string] $Port,
    '--username', $Username,
    '--no-password',
    '--maintenance-db', 'postgres',
    '--owner', $Username,
    $restoreDatabase
)

& $createdb.Source @createArguments
$createExitCode = $LASTEXITCODE
if ($createExitCode -ne 0) {
    throw "Could not create isolated restore database '$restoreDatabase' (exit code $createExitCode)."
}

$restoreArguments = @(
    '--host', $Server,
    '--port', [string] $Port,
    '--username', $Username,
    '--no-password',
    '--dbname', $restoreDatabase,
    '--no-owner',
    '--no-acl',
    '--exit-on-error',
    $resolvedArchivePath
)

& $pgRestore.Source @restoreArguments
$restoreExitCode = $LASTEXITCODE
if ($restoreExitCode -ne 0) {
    throw "Restore failed with exit code $restoreExitCode. The isolated database '$restoreDatabase' was retained for inspection; the live database was not targeted."
}

Write-Output "Restore completed in isolated database '$restoreDatabase'. Verify its contents before using it. The live database was not modified."
