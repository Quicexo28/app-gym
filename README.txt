# Coach AI Engineer — Plataforma de apoyo a decisiones de entrenamiento (Gym)

## Visión del producto (principios)
- La app **no decide**: genera **escenarios sugeridos** con incertidumbre explícita.
- Todo output “inteligente” es **probabilístico y explicable** (qué evidencia lo respalda).
- El sistema aprende **solo del historial individual** y de resultados observados (longitudinal).
- El criterio humano (usuario/coach) es la autoridad final; no se prometen predicciones exactas.
- La complejidad vive en el motor; la UI debe ser simple y orientada a decisiones.

---

## Stack y decisiones (y por qué)
- **Python + FastAPI**: API clara, rápida de iterar, tipado con Pydantic.
- **PostgreSQL + SQLAlchemy**: modelo relacional sólido para historial longitudinal, queries consistentes.
- **pytest**: validación científica/funcional; se exige estabilidad antes de avanzar fases.
- **ruff**: lint + formato rápido y consistente (evita discusiones de estilo).
- **Docker (Postgres)** en dev: entorno reproducible para DB.
- **Frontend: React + Vite + TypeScript**: DX rápido, tipado en UI, builds simples.

> Nota: el proyecto prioriza reproducibilidad y trazabilidad sobre “features rápidas”.

---

## Convenciones del código
- **No determinismo evitado**: si hay probabilidades, se devuelven con explicación y confianza.
- Separación por capas (pipeline inmutable):
  `Datos → Normalización individual → Métricas derivadas → Tendencias → Latentes → Estados probabilísticos → Escenarios → Decisión humana → Observación → Ajuste`
- Módulos en `src/coach_ai/*` para lógica científica y `src/app/*` para API/DB.
- Tests por módulo (`tests/<modulo>/...`) y tests e2e.
- Cambios grandes:
  - Si se modifica >2 líneas o se agrega archivo, se documenta y se validan checks globales.
- Verificación estándar antes de merge:
  ```bash
  ruff check . --fix
  ruff format .
  pytest -q
Módulos existentes (motor)
coach_ai.training_core: esquema de sesión, validación, normalización, métricas base.

coach_ai.trends: smoothing, derivadas discretas, clasificación de tendencia, pipeline.

coach_ai.latents: señales latentes (fatigue/readiness/plateau), sigmoides, confianza.

coach_ai.suggestions: motor de escenarios (alternativas + explicación + distribución de probabilidad).

coach_ai.e2e: runner end-to-end + logging + versionado del motor.

coach_ai.validation: simulación y evaluación básica (curvas internas / consistencia).

Backend (API) — Endpoints actuales (v1)
Base: /api/v1

Meta / Health
GET /meta/ping → { "pong": true }

Sessions (ingest)
POST /sessions/batch → ingesta batch de sesiones

(otros endpoints pueden existir según repo: listar por atleta, etc.)

Runs (pipeline end-to-end)
POST /runs / GET /runs/{run_id} (según implementación actual)

Crea un run con configuración (metric_key, normalización, etc.) y devuelve escenarios + log.

Auth / Settings / Plans (en progreso)
Auth/Settings y gating Free/Pro/Coach están planeados.

En este momento el estado puede variar por el reset de DB/Alembic (ver “Estado actual”).

Estado actual (qué funciona / qué no)
Funciona
Motor core (training_core → trends → latents → suggestions → e2e) con tests.

Checks de calidad: ruff + pytest pasando cuando DB/router están consistentes.

API base + router v1 + endpoint /meta/ping (usado por tests de health).

Frontend base React/Vite corriendo (UI mínima), con llamadas a API cuando backend está levantado.

Fragil / En progreso
Migraciones DB (Alembic): se reinició para recuperar consistencia (se debe rehacer limpio).

Auth + planes (free/pro/coach): especificado, pero requiere DB + migración estable + endpoints.

UI/UX de “gym-first” (ejercicios/rutinas/historial) está en etapa de diseño.
---

## Docker: dev vs production

- Dev stack: `docker-compose.yml` (Postgres + API + Frontend Vite con bind mount y reload).
- Production stack: `docker-compose.prod.yml` (Postgres + API + Web estatico).
- Guia operativa de produccion: `docs/docker-production.md`.

Flujo de desarrollo (un solo comando):

```bash
docker compose up --build
```

Servicios:
- Frontend: `http://localhost:5173`
- API: `http://localhost:8000`
- Postgres: `localhost:5432`

Flujo de deploy de produccion:

```bash
docker compose -f docker-compose.prod.yml build api web
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d api web
```

## Frontend (dev/build)

- `npm run dev` (desde la raiz) usa `frontend/vite.config.ts` y sirve la app real de `frontend/`.
- `npm run build` y `npm run preview` (desde la raiz) tambien operan sobre `frontend/`.

## Auth status (ready)
Implemented in current codebase:
- Register with email + password + optional phone number.
- Login with identifier (email or phone number) + password.
- Google sign in via backend token validation (`/api/v1/auth/google`).
- Friendly UI errors for invalid password, duplicated email, duplicated phone, and invalid input.
- Password confirmation in sign-up form.

Required configuration:
- Backend: set `GOOGLE_CLIENT_ID` in `.env`/`.env.prod`.
- Backend: set `ACCESS_TOKEN_MIN` for session duration in minutes (`43200` = 30 days).
- Frontend: set `VITE_GOOGLE_CLIENT_ID` in `frontend/.env.local`.
- Frontend: optional `VITE_ENABLE_GUEST_LOGIN=true` for debug quick access.
- Database: run migrations (`alembic upgrade head`) before using new auth fields.

Guest login:
- Endpoint: `POST /api/v1/auth/guest`.
- Enabled in non-production environments (`ENV != prod`).

Phone format accepted in login/register:
- E.164-like normalization is applied (digits only, stored as `+<digits>`).
- Examples: `+5491112345678`, `54 9 11 1234 5678`.

## Offline voice capture (V1)
- Scope: only `Nueva sesion` (`/session/new`) and only set variables.
- Feature flag: `VITE_ENABLE_OFFLINE_VOICE_CAPTURE=true`.
- Model sync (required before build/deploy):
  ```bash
  npm run voice:model:sync
  ```
- Local model path: `frontend/public/models/vosk-model-small-es-0.42.zip`.
- Engine: `vosk-browser@0.0.8` (offline on-device, no audio upload).
- Wake phrase: `coach`.
- Current target: first pending set in routine order.

Supported command intents (Spanish bounded free language):
- `set_load`: "coach peso 80", "coach carga 65.5"
- `set_reps`: "coach reps 8", "coach repeticiones 10"
- `set_set_effort`: "coach rpe 9", "coach intensidad 7"
- `set_set_completed`: "coach completar", "coach listo"

Current V1 limits:
- Desktop modern browsers only (Chrome/Edge).
- No mobile-browser guarantee in this iteration.
- No audio persistence. Only normalized transcript + applied/rejected audit is stored in `session.meta`.
