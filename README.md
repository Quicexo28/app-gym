# Alzo

[![CI](https://github.com/Quicexo28/app-gym/actions/workflows/ci.yml/badge.svg)](https://github.com/Quicexo28/app-gym/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Alzo es una app para registrar entrenamiento, dieta y medidas corporales, y ver señales y proyecciones sobre tus propios datos.**

La app **no decide por ti**. Muestra escenarios con su incertidumbre, su nivel de confianza y la regla que los originó. El atleta o su coach tienen la última palabra.

Disponible como web (PWA con modo offline), Android e iOS.

## Qué hace

**Entrenamiento**
- Crea rutinas y ejercicios propios.
- Registra sesiones: series, repeticiones, carga y esfuerzo.
- Registra series por voz y sin conexión. El reconocimiento de voz corre en el dispositivo.
- Planifica semanas y ciclos de entrenamiento.
- Consulta la evolución de las cargas por rutina y por ejercicio.

**Dieta**
- Diario de comidas con calorías, macronutrientes y micronutrientes.
- Escáner de código de barras y lectura de etiqueta nutricional en el dispositivo.
- Alimentos y comidas personales, objetivos nutricionales e historial.
- Catálogo de alimentos colombiano (TCAC) y datos de Open Food Facts.

**Medidas y progreso**
- Peso, perímetros y porcentaje de grasa, con su evolución.
- Fotos de progreso: se quedan en el dispositivo.

**Señales y proyecciones**
- Próximas series, marcas posibles y avisos.
- Cada señal indica la evidencia, la confianza y la regla que la produjo.
- El sistema guarda lo que proyectó y lo compara después con lo que pasó.

**Modo coach**
- El atleta se une con un código de invitación del coach.
- El coach ve entrenamientos, medidas y dieta, deja notas y asigna planes.

## Principios del producto

1. El sistema **no decide** acciones de entrenamiento. Devuelve **escenarios** con incertidumbre.
2. Toda sugerencia es **explicable** y lleva **confianza**, aunque sea baja.
3. El sistema aprende solo del historial de cada persona.
4. El humano manda. No se prometen predicciones exactas.
5. Cada regla nueva lleva tests. Los módulos son pequeños y versionables.

Más detalle en [CONTRIBUTING.md](CONTRIBUTING.md).

## Cómo funciona el motor

El motor vive en `src/coach_ai/`. Procesa los datos en capas, en este orden:

```
datos → métricas (training_core) → tendencias (trends) → estados latentes (latents)
      → escenarios sugeridos (suggestions) → decisión humana → observación → ajuste
```

- `training_core`: valida datos y calcula volumen, esfuerzo y normalización por persona.
- `trends`: suaviza las series y clasifica la tendencia (sube, baja, estable, volátil).
- `latents`: estima fatiga, disposición para entrenar y estancamiento.
- `suggestions`: genera escenarios con probabilidad y confianza.
- `e2e`: une todo, versiona las ejecuciones y guarda el registro de decisiones.

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Python 3.11+, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16 |
| Motor de análisis | `src/coach_ai/` (Python puro, con tests por módulo) |
| Frontend | React 19, TypeScript, Vite, PWA con modo offline |
| Móvil | Capacitor 8 (Android e iOS) |
| Calidad | pytest, ruff, ESLint, `tsc`, Vitest, GitHub Actions |

## Estructura del repo

| Ruta | Contenido |
|------|-----------|
| `src/app/` | API: auth, coach, nutrition, planning, profile, analytics, db |
| `src/coach_ai/` | Lógica científica del motor |
| `frontend/` | App web / PWA |
| `android/`, `ios/` | Proyectos nativos Capacitor |
| `migrations/` | Migraciones Alembic |
| `scripts/backtest/` | Backtests del motor contra datos reales |
| `scripts/tcac/` | Pipeline del catálogo de alimentos TCAC |
| `tests/` | pytest (backend y motor) |
| `deploy/`, `docker-compose.prod.yml` | Despliegue de producción |

## Empezar

Necesitas Docker.

```bash
docker compose up -d --build
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:8000> (`/health`, documentación interactiva en `/docs`)
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

CI (`.github/workflows/ci.yml`) corre ruff, pytest y `tsc` en cada push a `main` y en cada pull request.

## Documentación

- [COMMANDS.md](COMMANDS.md) — comandos del día a día.
- [docs/modulo-dieta.md](docs/modulo-dieta.md) — módulo de dieta y pipeline TCAC.
- [docs/docker-production.md](docs/docker-production.md) — despliegue en producción.
- [docs/publicacion-android.md](docs/publicacion-android.md) — publicación en Google Play.
- [docs/publicacion-ios.md](docs/publicacion-ios.md) — publicación en App Store.
- [docs/ficha-tiendas.md](docs/ficha-tiendas.md) — textos de la ficha para las tiendas.
- [docs/revision-app-2026-06.md](docs/revision-app-2026-06.md) — revisión técnica de junio 2026.

## Privacidad

Sin anuncios, sin rastreo y sin venta de datos. Las fotos de progreso y el audio de voz no salen del dispositivo.

## Licencia

[MIT](LICENSE)
