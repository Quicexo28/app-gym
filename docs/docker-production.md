# Docker Production Runbook (Always-On API + Postgres)

## Scope
- Deploy target: single cloud VM using `docker compose`.
- Components: `api` + `db` + `web` (frontend estatico servido por Nginx).
- TLS/ingress: external proxy (outside this compose).
- Migration strategy: run one-shot migration job before starting API.
- Availability target: brief downtime accepted.

## Files
- `Dockerfile.prod`: production image for the API.
- `frontend/Dockerfile.prod`: production image for el frontend estatico.
- `docker-compose.prod.yml`: production stack (`db`, `migrate`, `api`, `web`).
- `.env.prod.example`: template for production environment values.
- `deploy/deploy_prod.sh`: one-command deploy script for the VM.
- `deploy/install_systemd_service.sh`: optional boot-time systemd service setup.

## Prerequisites
- Linux VM with Docker Engine and Docker Compose plugin.
- External reverse proxy/LB configured to reach the VM API port.
- A real `.env.prod` file created from `.env.prod.example`.

## 1) Create production env file
```bash
cp .env.prod.example .env.prod
```

Minimum required values:
- `DATABASE_URL`
- `JWT_SECRET`
- `ENV=prod`
- `GOOGLE_CLIENT_ID` (required if Google login is enabled)
- `ACCESS_TOKEN_MIN` (token lifetime in minutes, e.g. `43200` = 30 days)

Recommended to update:
- `POSTGRES_PASSWORD`
- `POSTGRES_USER`
- `POSTGRES_DB`
- `API_PORT`
- `WEB_PORT`
- `CORS_ORIGINS` (include your real frontend origin)
- `VITE_API_BASE_URL`
- `VITE_GOOGLE_CLIENT_ID`

## 2) Deploy sequence
Run from repo root:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build api web
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d db
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm migrate
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api web
```

Notes:
- Do not skip `migrate`.
- If `migrate` fails, fix the issue and re-run it before bringing up `api`.

### 2.1) Deploy using helper script (recommended)
```bash
chmod +x deploy/deploy_prod.sh
./deploy/deploy_prod.sh
```

## 3) Post-deploy verification
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
curl -f http://127.0.0.1:${API_PORT:-8000}/health
curl -f http://127.0.0.1:${API_PORT:-8000}/api/v1/meta/ping
curl -f http://127.0.0.1:${WEB_PORT:-8080}
```

Expected:
- `db` is healthy.
- `api` is up/healthy.
- `web` is up/healthy.
- `/health` returns `{"status":"ok"}`.
- `/api/v1/meta/ping` returns `{"pong":true}`.

## 3.1) Frontend build env (Google + API URL)
Set in `.env.prod`:
- `VITE_API_BASE_URL=https://api.tu-dominio.com` (or empty for same-origin reverse proxy)
- `VITE_GOOGLE_CLIENT_ID=<same value as GOOGLE_CLIENT_ID>`
- `VITE_ENABLE_GUEST_LOGIN=false` (recommended in production)

Use the same Google OAuth client id in backend (`GOOGLE_CLIENT_ID`) and frontend (`VITE_GOOGLE_CLIENT_ID`).

Guest login endpoint (`/api/v1/auth/guest`) is disabled automatically when backend runs with `ENV=prod`.

### Google Login checklist (production)
- Add your exact frontend origin in Google Cloud Console -> OAuth client -> **Authorized JavaScript origins**.
  - Include scheme and port when applicable (e.g. `https://app.midominio.com`, `http://localhost:5173`).
- Ensure backend CORS allows your frontend origin (not only localhost).
- Ensure `GOOGLE_CLIENT_ID` (backend) and `VITE_GOOGLE_CLIENT_ID` (frontend) are identical.
- After deploy, test:
  - frontend can open Google sign-in prompt,
  - backend `POST /api/v1/auth/google` returns 200,
  - user reaches authenticated `/home`.

## 3.2) Keep service alive after VM reboot
Container restart policies are already `unless-stopped`. For extra safety you can also install the optional systemd unit:

```bash
chmod +x deploy/install_systemd_service.sh
sudo ./deploy/install_systemd_service.sh /opt/coach-ai-engineer-boilerplate
```

This removes dependency on your local PC and Docker Desktop.

## 4) Rollback
For this stage rollback is image-based plus DB restore when schema/data changed.

1. Switch API image tag back to previous stable image.
2. Restart API + Web:
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api web
```
3. If schema changes are incompatible, restore the DB backup taken before deploy.

## 5) Backup runbook (manual baseline)
Create backup directory:
```bash
mkdir -p backups
```

Dump DB from the running Postgres container:
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db \
  pg_dump -U "${POSTGRES_USER:-coach}" -d "${POSTGRES_DB:-coach_ai}" \
  > "backups/coach_ai_$(date +%Y%m%d_%H%M%S).sql"
```

Restore from SQL dump:
```bash
cat backups/<dump_file>.sql | docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db \
  psql -U "${POSTGRES_USER:-coach}" -d "${POSTGRES_DB:-coach_ai}"
```

## 6) Failure modes
- `db` not healthy: verify credentials and volume state, then re-check `docker compose logs db`.
- `migrate` fails: inspect logs, fix migration/data issue, rerun only `migrate`.
- API startup fails: verify `.env.prod` values (`DATABASE_URL`, `JWT_SECRET`, `ENV`).
- Proxy issues: validate API locally first via `127.0.0.1:${API_PORT}`.
