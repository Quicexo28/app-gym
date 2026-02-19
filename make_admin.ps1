param(
  [string]$Email = "santiagoquicenoqp@gmail.com",
  [ValidateSet("free", "pro", "coach")]
  [string]$Plan = "coach"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$pythonExe = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
  throw "No se encontro Python en la venv: $pythonExe"
}

$env:MAKE_ADMIN_ROOT = $PSScriptRoot
$env:MAKE_ADMIN_EMAIL = $Email
$env:MAKE_ADMIN_PLAN = $Plan

@'
import os
import sys
from pathlib import Path

from sqlalchemy import select

root = Path(os.environ["MAKE_ADMIN_ROOT"])
sys.path.insert(0, str(root / "src"))

from app.auth.types import Plan, Role
from app.db.engine import SessionLocal
from app.db.models_auth import User

email = os.environ["MAKE_ADMIN_EMAIL"].strip().lower()
plan_key = os.environ["MAKE_ADMIN_PLAN"].strip().lower()
plan_map = {"free": Plan.FREE, "pro": Plan.PRO, "coach": Plan.COACH}

if plan_key not in plan_map:
    raise SystemExit(f"Plan invalido: {plan_key}")

with SessionLocal() as db:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        raise SystemExit(f"Usuario no encontrado: {email}")

    user.role = Role.ADMIN
    user.plan = plan_map[plan_key]
    db.commit()
    print({"ok": True, "email": user.email, "role": user.role, "plan": user.plan})
'@ | & $pythonExe -

Remove-Item Env:MAKE_ADMIN_ROOT
Remove-Item Env:MAKE_ADMIN_EMAIL
Remove-Item Env:MAKE_ADMIN_PLAN
