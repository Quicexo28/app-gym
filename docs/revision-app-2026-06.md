# Revisión integral de la app — Junio 2026

Revisión de errores, bugs, oportunidades de mejora y propuestas de funciones nuevas.
Cubre backend (FastAPI), frontend (React) y el motor de análisis `coach_ai`.

---

## 1. Cómo está estructurada la app

**Backend — `src/app` (FastAPI + SQLAlchemy/PostgreSQL + Alembic)**

- **Auth**: JWT (HTTPBearer). Roles `user / coach / admin`, planes `free / pro / coach`, y "view modes" (`admin / coach / user_plus / user_normal`) que degradan el rol/plan efectivo vía `ContextVar`. Login por email/teléfono, Google y modo invitado.
- **Dominios**: sesiones de entrenamiento (`sessions`), análisis/predicciones (`runs`), planificación por ciclos macro/meso/micro (`planning`), medidas corporales (`body_metrics`), catálogo de ejercicios global+personalizado (`exercises_catalog`), perfil y gamificación (logros, medallas, rachas), administración.
- **Control de acceso a atletas**: atleta propio (derivado del `user_id`) + asignaciones coach→atleta (`CoachAthleteAssignment`), centralizado en `auth/athlete_access.py`.

**Motor de análisis — `src/coach_ai` (5 fases)**

`training_core` (validación y métricas: volumen, sRPE, normalización mediana/MAD) → `trends` (suavizado EWMA, derivadas, clasificación UP/DOWN/STABLE/VOLATILE) → `latents` (fatiga, readiness, plateau) → `suggestions` (escenarios con softmax) → `e2e` (orquestación, versionado, decision log). Integrado en `POST /api/v1/runs/{athlete_id}`. **Es la parte más sólida del proyecto**: bien testeada (18 archivos de test), sin bugs críticos.

**Frontend — `frontend/` (React 19 + Vite + React Router 7)**

- Estado con Context API (`auth`, `athlete`, `activeSession`, `preferences`, `viewMode`, `undo`, `exerciseCatalog`).
- Persistencia local en `localStorage` (sesión activa, rutinas, preferencias, token).
- Asistente de voz offline con `vosk-browser` (wake phrase, comandos para reps/carga/esfuerzo).

---

## 2. Errores y bugs (verificados en código)

### Críticos

| # | Hallazgo | Ubicación |
|---|----------|-----------|
| C1 | **Secreto JWT con default inseguro**: `JWT_SECRET = os.environ.get("JWT_SECRET", "dev-insecure-change-me")`. Si la variable no está definida en producción, cualquiera puede falsificar tokens de cualquier usuario, incluido admin. | `src/app/auth/security.py:16` |
| C2 | **Tokens de 30 días sin revocación**: `ACCESS_TOKEN_MIN = 43200` (30 días) y no existe logout del lado servidor ni blacklist. Un token robado sirve un mes. Además el rol/plan van embebidos en el JWT: si cambias el plan/rol de un usuario, su token viejo conserva los privilegios anteriores hasta expirar. | `src/app/auth/security.py:18,32-42` |
| C3 | **`.venv/` completo (≈4.400 archivos) y 104 `__pycache__/*.pyc` versionados en git**. El 95% del repo es entorno local: infla clones, genera conflictos y puede filtrar rutas/config locales. Falta `.gitignore` con `.venv/`, `__pycache__/`, `*.pyc`, `data/validation_tmp/`. | `.gitignore` |

### Altos

| # | Hallazgo | Ubicación |
|---|----------|-----------|
| A1 | **Logout forzado por caída de red**: en el arranque, si `getMe()` falla por *cualquier* motivo (backend caído, sin internet) se borra la sesión guardada. Debería distinguir 401/403 (token inválido → logout) de errores de red (mantener sesión y reintentar). | `frontend/src/state/auth.tsx:92-99` |
| A2 | **Ingesta batch con commit por sesión**: `upsert_session` hace `db.commit()` por fila; si la sesión 4 de 5 falla, las 3 primeras ya quedaron escritas y el cliente recibe un resultado parcial ambiguo. Debería ser una sola transacción o reportar parcialidad explícitamente. | `src/app/api/v1/endpoints/sessions.py`, `src/app/db/repo.py` |
| A3 | **Sin rate limiting en login/registro**: permite fuerza bruta de contraseñas y enumeración de usuarios. | `src/app/api/v1/endpoints/auth.py` |
| A4 | **Reset de `ContextVar` del view-mode con fallback inseguro**: si el teardown corre en otro contexto, `_CURRENT_VIEW_MODE.set(None)` puede tocar el contexto equivocado → posible fuga de modo de vista entre requests concurrentes. | `src/app/auth/deps.py`, `src/app/auth/view_mode.py` |
| A5 | **No existe recuperación de contraseña**: el API solo tiene register/login/google/guest. Un usuario que olvida su contraseña pierde la cuenta (salvo intervención manual de admin). | `src/app/api/v1/endpoints/auth.py` |

### Medios

| # | Hallazgo | Ubicación |
|---|----------|-----------|
| M1 | **Doble clic en "activar voz" crea dos recognizers**: el chequeo `voiceRecognizerRef.current` ocurre después de varios `await` (getUserMedia, import dinámico); dos llamadas concurrentes ven `null` y la primera instancia queda huérfana sin liberar micrófono/memoria. Falta un flag de "arranque en curso". | `frontend/src/pages/NewSession.tsx:757-841` |
| M2 | **`saveJSON` sin manejo de `QuotaExceededError`**: si localStorage se llena (borrador de sesión + auditoría de voz + rutinas), la excepción se propaga sin aviso y se puede perder el borrador. `loadJSON` sí tiene try/catch; `saveJSON` no. | `frontend/src/lib/storage.ts:11-13` |
| M3 | **N+1 en el hub de atletas**: 2 queries por atleta dentro de un bucle (conteo de sesiones y runs). Con 50 atletas son 100 queries; se resuelve con `GROUP BY athlete_id`. | `src/app/api/v1/endpoints/athletes.py:79-108` |
| M4 | **Sin paginación** en `/exercises/catalog`, `/planning/templates`, `/planning/assignments`, `/athletes/accessible`: cargan todo en memoria y la respuesta crece sin límite. | varios endpoints |
| M5 | **Cuentas invitado huérfanas**: cada `POST /auth/guest` crea un usuario permanente con contraseña aleatoria irrecuperable; no hay limpieza ni conversión a cuenta real. | `src/app/api/v1/endpoints/auth.py:223-269` |
| M6 | **CORS demasiado permisivo** (`allow_methods=["*"]`, `allow_headers=["*"]`) y **Swagger/ReDoc expuestos en producción** (`/docs`, `/redoc` sin gating por entorno). | `src/app/main.py` |
| M7 | **Índices únicos parciales solo-PostgreSQL** en el catálogo de ejercicios (`postgresql_where`): los tests sobre SQLite no validan esas restricciones de unicidad. | `src/app/db/models.py:222-234` |
| M8 | **Sin manejo global de 401 en el frontend**: si el token expira a mitad de uso, cada pantalla muestra su propio error en vez de redirigir al login. | `frontend/src/api.ts` |
| M9 | **Token en `localStorage`**: accesible a cualquier script (riesgo XSS). Compromiso habitual en SPA, pero combinado con tokens de 30 días (C2) el impacto de un robo es alto. | `frontend/src/state/auth.tsx:61` |

### Menores / limpieza

- **Scaffold de Vite muerto en la raíz**: `/src/App.tsx`, `/src/main.tsx`, `/index.html`, `/vite.config.ts`, `/tsconfig*.json` son la demo del contador de Vite; el frontend real está en `frontend/`. Borrarlos evita confusión.
- **`src/app/api/v1/routes/meta.py` duplicado y sin uso** (el router importa `endpoints/meta.py`).
- **`README.md` de la raíz es la plantilla de Vite**, no describe la app (hay un `README.txt` aparte). Unificar.
- **`data/validation_tmp/` versionado** (salida temporal de validación).
- `coach_ai` (3 detalles menores): fallback silencioso a distribución uniforme en `softmax` (`suggestions/scoring.py:18`, convendría loggear warning), `denom + epsilon` no garantiza denominador finito en `normalization.py:137` (mejor `max(abs(scale), epsilon)`), y faltan constraints de rango en `EndToEndConfig` (`ewma_alpha`, `fatigue_alpha`).

### Falsos positivos descartados durante la revisión

Se verificaron y **no** son bugs: la conversión de zona horaria en `deviceDatetimeLocal()`/`toISOZ()` (es el idiom correcto para inputs `datetime-local`), el manejo de errores al enviar la sesión (existe try/catch con mensaje al usuario), y los callbacks de voz (usan functional updates, no hay stale closures relevantes).

---

## 3. Mejoras recomendadas (orden de prioridad)

1. **Endurecer auth**: exigir `JWT_SECRET` sin default (fallar al arrancar si falta), bajar expiración a horas + refresh token, rate limiting en `/auth/*` (p. ej. `slowapi`), recuperación de contraseña.
2. **Limpiar el repo**: sacar `.venv/`, `__pycache__`, `data/validation_tmp/` de git (`git rm -r --cached`), completar `.gitignore`, borrar scaffold raíz y `routes/meta.py`.
3. **CI**: no hay `.github/workflows`. Un workflow con `ruff check`, `pytest`, `tsc --noEmit` y `vite build` atraparía regresiones (el proyecto ya tiene ruff y pytest configurados).
4. **Resiliencia frontend**: distinguir error de red vs 401 en el boot de auth (A1), interceptor global de 401, try/catch con aviso en `saveJSON`, flag anti-doble-arranque en voz.
5. **Transacción única** (o modo `all_or_nothing`) en la ingesta batch de sesiones.
6. **Paginación + arreglo del N+1** en hub de atletas.
7. **Ocultar `/docs` y `/redoc` fuera de `env=dev`** y restringir métodos/headers CORS.
8. **Tests de frontend**: hoy no existe ninguno; el parser de comandos de voz (`lib/voice/commandParser.ts`) y `lib/storage.ts` (migraciones de esquema) son candidatos ideales para Vitest por ser lógica pura.

---

## 4. Funciones nuevas propuestas

1. **Rutinas sincronizadas en el backend** *(la más importante)*. Hoy las rutinas viven solo en `localStorage` (`frontend/src/lib/storage.ts`): se pierden al limpiar el navegador, no sincronizan entre móvil y PC, y un coach no puede asignar rutinas reales a sus atletas (la "propagación" actual solo copia entre scopes del mismo navegador). Un CRUD `/api/v1/routines` con scope por atleta encaja directo en el modelo existente.
2. **PWA / modo offline para la sesión activa**: es una app de gimnasio y el móvil suele perder señal. Service worker + manifest + cola de envío: la sesión terminada se guarda local y se sube cuando hay red. El borrador en localStorage ya existe; falta la cola de sincronización y el manifest instalable.
3. **Progresión por ejercicio**: gráficas de e1RM, mejor serie y volumen por ejercicio a lo largo del tiempo, con PRs detectados automáticamente. Los datos ya están en `TrainingSession.exercises`; los `runs` actuales solo analizan métricas agregadas de sesión. Conectaría además con la gamificación (PRs de básicos ya existen en perfil).
4. **Conversión de cuenta invitado → cuenta real**: endpoint que añade email+contraseña a un usuario guest conservando sus datos (resuelve también M5).
5. **Exportación de datos del atleta** (CSV/JSON de sesiones y medidas): valor directo para coaches y buena práctica de propiedad de datos.
6. **Notificaciones de planificación**: recordatorio del bloque del día según el `CycleAssignment` activo (el frontend ya pide permiso de `Notification` para el timer de descanso; reutilizable).
7. **Dashboard comparativo para coach**: vista multi-atleta con adherencia, tendencia y readiness lado a lado (los datos ya salen de `planning/metrics` y `runs`).
