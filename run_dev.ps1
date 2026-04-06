param(
  [switch]$NoFrontend,
  [switch]$DockerFrontend,
  [int]$HealthRetries = 20,
  [int]$HealthDelaySeconds = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

function Wait-ApiHealth {
  param(
    [int]$Retries,
    [int]$DelaySeconds
  )

  $uri = "http://127.0.0.1:8000/health"
  for ($i = 1; $i -le $Retries; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 5
      if ($res.StatusCode -eq 200) {
        Write-Host "==> API healthy: $($res.Content)" -ForegroundColor Green
        return
      }
    } catch {
      # keep trying
    }

    Write-Host "==> Waiting API health ($i/$Retries)..." -ForegroundColor DarkYellow
    Start-Sleep -Seconds $DelaySeconds
  }

  throw "API did not become healthy at $uri"
}

Write-Host "==> Starting Docker services (db + api)..." -ForegroundColor Cyan
docker compose up -d db api
if ($LASTEXITCODE -ne 0) {
  throw "Failed to start docker compose services db/api."
}

Wait-ApiHealth -Retries $HealthRetries -DelaySeconds $HealthDelaySeconds

if ($DockerFrontend) {
  Write-Host "==> Starting Docker frontend service..." -ForegroundColor Cyan
  docker compose up -d frontend
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start docker compose frontend service."
  }

  Write-Host "==> Dev stack ready:" -ForegroundColor Green
  Write-Host "   Frontend: http://localhost:5173"
  Write-Host "   API:      http://localhost:8000"
  Write-Host "   Postgres: localhost:5432"
  exit 0
}

if ($NoFrontend) {
  Write-Host "==> API/DB ready. Frontend not started (NoFrontend)." -ForegroundColor Green
  Write-Host "   Run frontend manually with: npm run dev"
  exit 0
}

Write-Host "==> Starting frontend (npm run dev)..." -ForegroundColor Cyan
npm run dev
