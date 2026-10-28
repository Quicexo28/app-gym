# Alzo

Plataforma de apoyo a decisiones de entrenamiento y dieta. La app **no decide**: muestra
señales y proyecciones con incertidumbre explícita; el atleta o el coach tienen la última palabra.

## Stack

- **Backend**: Python 3.11+, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16.
- **Motor**: `src/coach_ai/` (training_core, trends, latents, suggestions, insights, compliance, e2e, validation).
- **Frontend**: React 19 + TypeScript + Vite, PWA con modo offline (`frontend/`).
- **Android**: Capacitor 8 (`android/`, appId `com.santiagoquiceno.alzo`).

## Estructura

| Ruta | Contenido |
|------|-----------|
| `src/app/` | API: auth, coach, nutrition, planning, profile, analytics, db |
| `src/coach_ai/` | Lógica científica del motor |
| `frontend/` | App web / PWA |
| `android/` | Proyecto nativo Capacitor |
| `migrations/` | Migraciones Alembic |
| `scripts/backtest/` | Backtests del motor contra datos reales |
| `scripts/tcac/` | Pipeline del catálogo de alimentos TCAC |
| `tests/` | pytest (backend y motor) |
| `deploy/`, `docker-compose.prod.yml` | Despliegue de producción |

## Desarrollo

```bash
docker compose up -d --build
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:8000> (`/health`, docs en `/docs`)
- Postgres: `localhost:5432`

La API aplica `alembic upgrade head` al arrancar. El resto de comandos está en [COMMANDS.md](COMMANDS.md).

## Calidad

```bash
.venv-linux/bin/python -m pytest -q
.venv-linux/bin/ruff check .
npm run lint
npx tsc -b frontend/tsconfig.json
cd frontend && npm test
```

## Documentación

- [docs/docker-production.md](docs/docker-production.md) — despliegue en producción.
- [docs/publicacion-android.md](docs/publicacion-android.md) — publicación en Google Play.
- [docs/modulo-dieta.md](docs/modulo-dieta.md) — módulo de dieta y pipeline TCAC.
- [CONTRIBUTING.md](CONTRIBUTING.md) — principios no negociables.
