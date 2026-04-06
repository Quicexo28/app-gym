param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Version -notmatch '^v?\d+\.\d+\.\d+$') {
  throw "Use semver format, e.g. 0.1.1 or v0.1.1"
}

$tag = if ($Version.StartsWith('v')) { $Version } else { "v$Version" }

Write-Host "==> Creating tag $tag" -ForegroundColor Cyan
git tag $tag
if ($LASTEXITCODE -ne 0) { throw "Failed to create tag" }

Write-Host "==> Pushing tag $tag" -ForegroundColor Cyan
git push origin $tag
if ($LASTEXITCODE -ne 0) { throw "Failed to push tag" }

Write-Host "==> Tag published: $tag" -ForegroundColor Green
