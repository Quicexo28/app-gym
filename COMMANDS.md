# Comandos utiles (PowerShell)

Ejecuta todo desde la raiz del proyecto: `c:\proyecto gym\coach-ai-engineer-boilerplate`

## 1) Backend API

```powershell
.\run_api.ps1
.\run_api.ps1 -Port 8001
.\run_api.ps1 -NoReload
```

## 2) Docker (dev)

```powershell
docker compose up --build
docker compose down
docker compose logs -f api
docker compose logs -f frontend
```

### One-click dev up (recomendado)

```powershell
.\run_dev.ps1
.\run_dev.ps1 -NoFrontend
.\run_dev.ps1 -DockerFrontend
```

- `run_dev.ps1` levanta `db + api`, espera `health=ok` y luego arranca frontend.
- `-NoFrontend`: deja solo backend+db listos.
- `-DockerFrontend`: levanta frontend en Docker en lugar de `npm run dev`.

Servicios:
- Frontend: `http://localhost:5173`
- API: `http://localhost:8000`
- Postgres: `localhost:5432`

Checks de salud:
- `http://127.0.0.1:8000/health` (liveness)
- `http://127.0.0.1:8000/ready` (readiness: DB + migraciones)

Observabilidad (eventos de negocio):
- Logs API incluyen eventos `app.business` como `login_*`, `session_ingested`, `run_created`.
- Ver en vivo: `docker compose logs -f api | findstr /I "business_event"`

## 3) Frontend

```powershell
npm run dev
npm run voice:model:sync
npm run build
npm run preview
```

`voice:model:sync` descarga el modelo offline de voz en `frontend/public/models/vosk-model-small-es-0.42.zip`.

## 4) Migraciones DB (Alembic)

```powershell
.\.venv\Scripts\Activate.ps1
alembic upgrade head
alembic revision --autogenerate -m "descripcion_del_cambio"
```

## 5) Calidad (tests + lint)

```powershell
pytest -q
ruff check . --fix
ruff format .
```

## 6) Admin

### 6.0 Comando corto para volver admin

```powershell
.\make_admin.ps1
.\make_admin.ps1 -Email "usuario@dominio.com"
.\make_admin.ps1 -Email "usuario@dominio.com" -Plan coach
```

### 6.1 Recuperar admin directo en DB (si te quedaste sin permisos)

Este bloque deja a `santiagoquicenoqp@gmail.com` con `role=admin` y `plan=coach`.

```powershell
@'
import sys
from pathlib import Path
from sqlalchemy import select

sys.path.insert(0, str(Path.cwd() / "src"))

from app.auth.types import Plan, Role
from app.db.engine import SessionLocal
from app.db.models_auth import User

EMAIL = "santiagoquicenoqp@gmail.com"

with SessionLocal() as db:
    user = db.execute(select(User).where(User.email == EMAIL)).scalar_one_or_none()
    if user is None:
        raise SystemExit(f"Usuario no encontrado: {EMAIL}")

    user.role = Role.ADMIN
    user.plan = Plan.COACH
    db.commit()
    print({"ok": True, "email": user.email, "role": user.role, "plan": user.plan})
'@ | python -
```

### 6.2 Login para obtener token

```powershell
$authBody = @{
  identifier = "santiagoquicenoqp@gmail.com"
  password   = "TU_PASSWORD"
} | ConvertTo-Json

$auth = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8000/api/v1/auth/login" `
  -ContentType "application/json" `
  -Body $authBody

$token = $auth.access_token
$headers = @{ Authorization = "Bearer $token" }
```

### 6.3 Cambiar plan/rol de cualquier usuario (requiere token admin)

```powershell
$payload = @{
  email = "usuario@dominio.com"
  plan  = "coach"   # free | pro | coach
  role  = "coach"   # user | coach | admin
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8000/api/v1/admin/dev/switch-plan" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $payload
```

### 6.4 Asignar atleta a coach (requiere token admin)

```powershell
$assign = @{
  coach_email = "coach@dominio.com"
  athlete_id  = "user_xxx"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8000/api/v1/admin/dev/coach-athletes/assign" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $assign
```

### 6.5 Ver atletas asignados a un coach (requiere token admin)

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://127.0.0.1:8000/api/v1/admin/dev/coach-athletes/coach@dominio.com" `
  -Headers $headers
```

### 6.6 Remover asignacion coach-atleta (requiere token admin)

```powershell
$remove = @{
  coach_email = "coach@dominio.com"
  athlete_id  = "user_xxx"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Delete `
  -Uri "http://127.0.0.1:8000/api/v1/admin/dev/coach-athletes/assign" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $remove
```
