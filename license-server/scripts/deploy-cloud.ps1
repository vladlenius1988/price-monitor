param(
  [ValidateSet('staging', 'production')]
  [string]$Environment = 'staging',
  [switch]$SkipBackup
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverRoot = Join-Path $repositoryRoot 'license-server'
$databaseName = if ($Environment -eq 'production') { 'price-monitor-production' } else { 'price-monitor-staging' }
$healthUrl = if ($Environment -eq 'production') {
  'https://price-monitor-license-production.vladlenius.workers.dev/health'
} else {
  'https://price-monitor-license-staging.vladlenius.workers.dev/health'
}

if ($Environment -eq 'production' -and -not $SkipBackup) {
  & (Join-Path $PSScriptRoot 'backup-cloud.ps1') -Environment production
  if ($LASTEXITCODE -ne 0) { throw 'Production backup failed. Deployment stopped.' }
}

Push-Location $serverRoot
try {
  & npx wrangler d1 migrations apply $databaseName --remote --env $Environment --config wrangler.jsonc
  if ($LASTEXITCODE -ne 0) { throw "D1 migration failed with exit code $LASTEXITCODE" }
  & npx wrangler deploy --env $Environment --config wrangler.jsonc
  if ($LASTEXITCODE -ne 0) { throw "Worker deployment failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$health = $null
for ($attempt = 1; $attempt -le 4; $attempt++) {
  try {
    $candidate = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 30
    if ($candidate.ok -and $candidate.database -eq 'ready') {
      $health = $candidate
      break
    }
  } catch {
    if ($attempt -eq 4) { throw }
  }
  if ($attempt -lt 4) { Start-Sleep -Seconds 3 }
}
if (-not $health) { throw 'Deployed server did not pass the database health check after four attempts.' }
Write-Host "Deployment verified: $($health.environment) $($health.version), database $($health.database)"
