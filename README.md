# Coach AI Engineer Boilerplate

![release-gate](https://github.com/Quicexo28/app-gym/actions/workflows/release-gate.yml/badge.svg)

Plataforma gym-first para captura de sesiones, planificación por ciclos y soporte de decisiones con escenarios probabilísticos explicables.

## Stack
- Backend: FastAPI + SQLAlchemy + Alembic + Postgres
- Frontend: React + TypeScript + Vite
- Motor: pipeline trends/latents/suggestions

## Inicio rápido (dev)

```powershell
.\run_dev.ps1
```

Servicios esperados:
- Frontend: <http://localhost:5173>
- API: <http://localhost:8000>

## Release hardening

Gate local:

```powershell
.\run_release_gate.ps1
```

Smoke E2E local:

```powershell
.\run_smoke_e2e.ps1
```

Reporte rápido de eventos de negocio (logs API):

```powershell
.\scripts\business-events-report.ps1
```

## CI/CD

Workflow: `.github/workflows/release-gate.yml`

Se ejecuta en PR, push a main y manual dispatch:
- migraciones
- tests críticos backend
- lint + build frontend
- check `/health` + `/ready`

## Operación

- Runbook hardening: `docs/release-hardening-runbook.md`
- Branch protection: `docs/branch-protection.md`
- Comandos útiles: `COMMANDS.md`
