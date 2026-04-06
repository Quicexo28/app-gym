# Release Hardening Runbook (Fase 4)

Este runbook define un gate minimo de salida para reducir regresiones antes de release.

## 1) Gate automatizado (un comando)

```powershell
.\run_release_gate.ps1
```

## 1.1) Gate automatizado en CI (GitHub Actions)

Workflow: `.github/workflows/release-gate.yml`

Dispara en:
- `pull_request`
- `push` a `main`
- `workflow_dispatch`

Valida en CI:
- Postgres service + `alembic upgrade head`
- tests críticos backend
- `npm run lint`
- `npm run build`
- boot de API + checks `/health` y `/ready` (`ready=true`)

El script ejecuta:
1. `docker compose up -d db api`
2. Espera `GET /ready` con `ready=true`
3. Pytest critico:
   - `tests/test_health.py`
   - `tests/test_auth_flow.py`
   - `tests/test_sessions_planning_access.py`
4. `npm run lint`
5. `npm run build`

### Variantes

```powershell
.\run_release_gate.ps1 -SkipFrontendBuild
.\run_release_gate.ps1 -SkipFrontendLint
.\run_release_gate.ps1 -SkipBackendTests
.\run_release_gate.ps1 -SkipDockerUp
```

---

## 2) Smoke manual post-deploy (5 minutos)

1. **Infra**
   - `GET /health` => `{"status":"ok"}`
   - `GET /ready` => `ready=true`
2. **Auth**
   - Login email/telefono OK
   - Login Google OK (si aplica entorno)
3. **Core flujo**
   - Crear sesion
   - Correr escenarios (run)
   - Ver detalle de run
4. **Planning**
   - Abrir tracking
   - Ver KPIs de adherencia/riesgo

---

## 3) Rollback operativo

Si falla release:
1. volver a imagen/tag anterior en API/frontend,
2. validar `/health` + `/ready`,
3. verificar login + historial,
4. documentar incidente (causa + fix + prevención).

---

## 4) Criterio de salida

Un release se considera apto cuando:
- gate automatizado en verde,
- smoke manual sin bloqueos,
- sin errores críticos nuevos en logs de negocio (`business_event` con `*_fail` anómalos).

## 5) Warnings conocidos (no bloqueantes)

- `optimizeDeps.esbuildOptions` deprecado con `rolldown-vite`:
  - actualmente proviene de plugin/dependencia de Vite y no bloquea build.
  - mantener monitoreo y actualizar cuando el plugin exponga configuración `rolldownOptions` sin incompatibilidades de tipos.
