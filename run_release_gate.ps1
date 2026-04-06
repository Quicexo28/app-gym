param(
  [switch]$SkipDockerUp,
  [switch]$SkipFrontendLint,
  [switch]$SkipFrontendBuild,
  [switch]$SkipBackendTests,
  [int]$ReadyRetries = 30,
  [int]$ReadyDelaySeconds = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Wait-Ready {
  param(
    [int]$Retries,
    [int]$DelaySeconds
  )

  $uri = "http://127.0.0.1:8000/ready"
  for ($i = 1; $i -le $Retries; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 6
      if ($res.StatusCode -eq 200) {
        $payload = $res.Content | ConvertFrom-Json
        if ($payload.ready -eq $true) {
          Write-Host "==> READY OK: $($res.Content)" -ForegroundColor Green
          return
        }
      }
    } catch {
      # keep waiting
    }

    Write-Host "==> Waiting /ready ($i/$Retries)..." -ForegroundColor DarkYellow
    Start-Sleep -Seconds $DelaySeconds
  }

  throw "Release gate failed: API did not reach ready=true at /ready"
}

if (-not $SkipDockerUp) {
  Write-Host "==> Bringing up db + api..." -ForegroundColor Cyan
  docker compose up -d db api
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed"
  }
}

Wait-Ready -Retries $ReadyRetries -DelaySeconds $ReadyDelaySeconds

if (-not $SkipBackendTests) {
  Write-Host "==> Running backend release checks (pytest subset)..." -ForegroundColor Cyan
  $env:PYTHONPATH = "src"
  .\.venv\Scripts\python.exe -m pytest -q tests/test_health.py tests/test_auth_flow.py tests/test_sessions_planning_access.py
  if ($LASTEXITCODE -ne 0) {
    throw "Backend tests failed"
  }
}

if (-not $SkipFrontendLint) {
  Write-Host "==> Running frontend lint..." -ForegroundColor Cyan
  npm run lint
  if ($LASTEXITCODE -ne 0) {
    throw "Frontend lint failed"
  }
}

if (-not $SkipFrontendBuild) {
  Write-Host "==> Running frontend build..." -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Frontend build failed"
  }
}

Write-Host "==> RELEASE GATE PASSED" -ForegroundColor Green
