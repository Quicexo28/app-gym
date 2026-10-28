# Comandos utiles (Linux, fish)

Ejecuta todo desde la raiz del proyecto: `~/Projects/app-gym`

## 1) Docker (dev)

```fish
docker compose up -d --build
docker compose down
docker compose logs -f api
docker compose logs -f frontend
```

Servicios:
- Frontend: `http://localhost:5173`
- API: `http://localhost:8000`
- Postgres: `localhost:5432`

## 2) Backend API sin Docker

Requiere Postgres arriba (`docker compose up -d db`).

```fish
.venv-linux/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir src
```

Crear la venv desde cero:

```fish
python -m venv .venv-linux
.venv-linux/bin/python -m pip install -e '.[dev]'
```

## 3) Frontend

```fish
npm run dev
npm run voice:model:sync
npm run build
npm run preview
```

`voice:model:sync` descarga el modelo offline de voz en `frontend/public/models/vosk-model-small-es-0.42.zip`.

## 4) Android

```fish
npm run build:mobile
npm run android:apk
npm run android:aab
```

Detalle en `docs/publicacion-android.md`.

## 5) Migraciones DB (Alembic)

```fish
.venv-linux/bin/alembic upgrade head
.venv-linux/bin/alembic revision --autogenerate -m "descripcion_del_cambio"
```

## 6) Calidad (tests + lint)

```fish
.venv-linux/bin/python -m pytest -q
.venv-linux/bin/ruff check . --fix
npm run lint
npx tsc -b frontend/tsconfig.json
cd frontend; and npm test
```

## 7) Admin

### 7.1 Volver admin a un usuario directo en DB

Deja al usuario con `role=admin` y el plan indicado (`free` | `pro` | `coach`).

```fish
set -x MAKE_ADMIN_EMAIL usuario@dominio.com
set -x MAKE_ADMIN_PLAN coach
echo '
import os
from sqlalchemy import select
from app.auth.types import Plan, Role
from app.db.engine import SessionLocal
from app.db.models_auth import User

email = os.environ["MAKE_ADMIN_EMAIL"].strip().lower()
plan = Plan(os.environ["MAKE_ADMIN_PLAN"].strip().lower())

with SessionLocal() as db:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        raise SystemExit(f"Usuario no encontrado: {email}")
    user.role = Role.ADMIN
    user.plan = plan
    db.commit()
    print({"ok": True, "email": user.email, "role": user.role, "plan": user.plan})
' | docker compose exec -T -e MAKE_ADMIN_EMAIL -e MAKE_ADMIN_PLAN api python -
```

### 7.2 Login para obtener token

```fish
set TOKEN (curl -s http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier": "usuario@dominio.com", "password": "TU_PASSWORD"}' | jq -r .access_token)
```

### 7.3 Cambiar plan/rol de cualquier usuario (requiere token admin)

```fish
curl -s -X POST http://127.0.0.1:8000/api/v1/admin/dev/switch-plan \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"email": "usuario@dominio.com", "plan": "coach", "role": "coach"}'
```

`plan`: `free` | `pro` | `coach`. `role`: `user` | `coach` | `admin`.

### 7.4 Asignar atleta a coach (requiere token admin)

```fish
curl -s -X POST http://127.0.0.1:8000/api/v1/admin/dev/coach-athletes/assign \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"coach_email": "coach@dominio.com", "athlete_id": "user_xxx"}'
```

### 7.5 Ver atletas asignados a un coach (requiere token admin)

```fish
curl -s http://127.0.0.1:8000/api/v1/admin/dev/coach-athletes/coach@dominio.com \
  -H "Authorization: Bearer $TOKEN"
```

### 7.6 Remover asignacion coach-atleta (requiere token admin)

```fish
curl -s -X DELETE http://127.0.0.1:8000/api/v1/admin/dev/coach-athletes/assign \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"coach_email": "coach@dominio.com", "athlete_id": "user_xxx"}'
```
