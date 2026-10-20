param(
  [ValidateSet('staging', 'production')]
  [string]$Environment = 'production'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverRoot = Join-Path $repositoryRoot 'license-server'
$databaseName = if ($Environment -eq 'production') { 'price-monitor-production' } else { 'price-monitor-staging' }
$backupDirectory = Join-Path $repositoryRoot "backups\cloud\$Environment"
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputPath = Join-Path $backupDirectory "$databaseName-$timestamp.sql"

New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
Push-Location $serverRoot
try {
  & npx wrangler d1 export $databaseName --remote --env $Environment --config wrangler.jsonc --skip-confirmation --output $outputPath
  if ($LASTEXITCODE -ne 0) { throw "Cloudflare D1 export failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath).Hash
Set-Content -LiteralPath "$outputPath.sha256" -Value "$hash  $([IO.Path]::GetFileName($outputPath))" -Encoding ascii
Write-Host "Backup created: $outputPath"
Write-Host "SHA256: $hash"
