param(
  [int]$Tail = 2000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$raw = docker compose logs --tail $Tail api 2>$null
if (-not $raw) {
  Write-Host "No API logs found (is docker compose api running?)." -ForegroundColor Yellow
  exit 0
}

$lines = $raw -split "`r?`n" | Where-Object { $_ -match "business_event" }
if ($lines.Count -eq 0) {
  Write-Host "No business_event entries in last $Tail lines." -ForegroundColor Yellow
  exit 0
}

$counts = @{}
foreach ($line in $lines) {
  if ($line -match "\{.*\}") {
    $jsonText = $matches[0]
    try {
      $obj = $jsonText | ConvertFrom-Json
      $event = [string]$obj.event
      if (-not $event) { continue }
      if (-not $counts.ContainsKey($event)) { $counts[$event] = 0 }
      $counts[$event] += 1
    } catch {
      # ignore malformed
    }
  }
}

if ($counts.Keys.Count -eq 0) {
  Write-Host "No parseable business_event payloads found." -ForegroundColor Yellow
  exit 0
}

Write-Host "Business events (last $Tail API log lines):" -ForegroundColor Cyan
$counts.GetEnumerator() |
  Sort-Object Name |
  ForEach-Object { "{0,-28} {1,6}" -f $_.Key, $_.Value } | Write-Host
