param(
  [string]$ApiBase = "http://127.0.0.1:8000",
  [switch]$NoSeedSession
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Json {
  param(
    [string]$Method,
    [string]$Url,
    [object]$Body,
    [hashtable]$Headers
  )

  $params = @{
    Method = $Method
    Uri = $Url
    TimeoutSec = 20
    UseBasicParsing = $true
    Headers = $Headers
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 12)
  }
  $res = Invoke-WebRequest @params
  if (-not $res.Content) { return $null }
  return ($res.Content | ConvertFrom-Json)
}

Write-Host "==> Smoke E2E against $ApiBase" -ForegroundColor Cyan

$health = $null
for ($i = 1; $i -le 20; $i++) {
  try {
    $health = Invoke-Json -Method "GET" -Url "$ApiBase/health" -Body $null -Headers @{}
    if ($health.status -eq "ok") { break }
  } catch {
    Start-Sleep -Seconds 1
  }
}
if ($null -eq $health -or $health.status -ne "ok") { throw "health failed" }

$ready = Invoke-Json -Method "GET" -Url "$ApiBase/ready" -Body $null -Headers @{}
if (-not $ready.ready) { throw "ready failed: $($ready | ConvertTo-Json -Depth 6)" }
Write-Host "==> health/ready OK" -ForegroundColor Green

$guest = Invoke-Json -Method "POST" -Url "$ApiBase/api/v1/auth/guest" -Body @{} -Headers @{}
$token = [string]$guest.token.access_token
$userId = [string]$guest.user.id
if (-not $token -or -not $userId) { throw "guest login failed" }
$auth = @{ Authorization = "Bearer $token" }
Write-Host "==> guest auth OK ($($guest.user.email))" -ForegroundColor Green

$me = Invoke-Json -Method "GET" -Url "$ApiBase/api/v1/me" -Body $null -Headers $auth
if (-not $me.id) { throw "me endpoint failed" }

$userIdHex = ([string]$me.id).Replace("-", "").ToLowerInvariant()
$athleteId = "user_$userIdHex"
Write-Host "==> derived athlete_id: $athleteId" -ForegroundColor Green

if (-not $NoSeedSession) {
  $now = (Get-Date).ToUniversalTime().ToString("s") + "Z"
  $sessionObj = @{
    athlete_id = $athleteId
    start_time = $now
    duration_min = 45
    rpe = 7
    modality = "strength"
    exercises = @(
      @{
        name = "Bench Press"
        sets = @(
          @{ reps = 8; load_kg = 60 }
        )
      }
    )
    source = "smoke"
    meta = @{ note = "smoke_e2e" }
  }

  $ingestBody = "[$($sessionObj | ConvertTo-Json -Depth 12)]"
  $ingestRes = Invoke-WebRequest -Method "POST" -Uri "$ApiBase/api/v1/sessions/batch" -UseBasicParsing -TimeoutSec 20 -Headers $auth -ContentType "application/json" -Body $ingestBody
  $ingest = if ($ingestRes.Content) { $ingestRes.Content | ConvertFrom-Json } else { $null }
  Write-Host "==> sessions batch OK (inserted=$($ingest.inserted), duplicates=$($ingest.duplicates))" -ForegroundColor Green
}

$runs = Invoke-Json -Method "POST" -Url "$ApiBase/api/v1/runs/$athleteId" -Body $null -Headers $auth
$runId = [string]$runs.run_id
if (-not $runId) { throw "run creation failed" }
Write-Host "==> run created: $runId" -ForegroundColor Green

$summary = Invoke-Json -Method "GET" -Url "$ApiBase/api/v1/runs/$runId/summary" -Body $null -Headers $auth
if (-not $summary.run_id) { throw "run summary failed" }
Write-Host "==> run summary OK (metric=$($summary.metric_key))" -ForegroundColor Green

$planningRes = Invoke-WebRequest -Method "GET" -Uri "$ApiBase/api/v1/planning/templates?level=micro" -UseBasicParsing -TimeoutSec 20 -Headers $auth
if ($planningRes.StatusCode -ne 200) { throw "planning templates failed" }
Write-Host "==> planning templates OK" -ForegroundColor Green

Write-Host "==> SMOKE E2E PASSED" -ForegroundColor Green
