param(
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 8000,
  [switch]$NoReload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Ir a la carpeta donde está este script (raíz del repo)
Set-Location $PSScriptRoot

# Activar venv
$venvActivate = Join-Path $PSScriptRoot ".venv\Scripts\Activate.ps1"
if (-not (Test-Path $venvActivate)) {
  throw "No se encontró la venv en: $venvActivate. Crea la .venv primero."
}
. $venvActivate

# Construir args para uvicorn
$uvArgs = @("app.main:app", "--host", $BindHost, "--port", "$Port")
if (-not $NoReload) {
  $uvArgs += "--reload"
}

Write-Host "==> Starting API at http://$BindHost`:$Port (reload=$(-not $NoReload))" -ForegroundColor Green
python -m uvicorn @uvArgs
