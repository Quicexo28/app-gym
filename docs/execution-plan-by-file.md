# Plan de ejecución por archivo (mejoras + faltantes)

Este plan aterriza mejoras concretas por archivo/módulo, con prioridad, impacto y dificultad.

Escala usada:
- **Impacto**: Alto / Medio / Bajo
- **Dificultad**: Alta / Media / Baja
- **Prioridad**: P0 (urgente), P1 (siguiente), P2 (después)

---

## P0 — Bloque crítico: Login con Google + estabilidad base

## A) Arreglar conexión de Google Login

### `frontend/src/pages/Login.tsx`
- **Estado actual**: usa Google Identity prompt; sensible a estados de navegador/origen.
- **Mejoras aplicadas**:
  - carga del SDK más robusta (evita estados colgados cuando el script ya existe),
  - configuración de `initialize` con opciones modernas (`use_fedcm_for_prompt`, `itp_support`, etc.),
  - manejo de errores más preciso (origen no autorizado, client id inválido, missing client id),
  - menos falsos negativos por `skipped/dismissed` (se maneja por timeout y reintento).
- **Impacto**: Alto
- **Dificultad**: Baja
- **Prioridad**: P0

### `src/app/core/config.py`
- **Pendiente recomendado**:
  - habilitar configuración explícita de `cors_origins` en entornos reales (no solo localhost),
  - documentar formato esperado para lista de orígenes.
- **Impacto**: Alto (si frontend y backend están en dominios distintos)
- **Dificultad**: Baja
- **Prioridad**: P0

### `.env.prod.example` y `.env`
- **Pendiente recomendado**:
  - agregar/usar `CORS_ORIGINS` para dominios reales,
  - mantener consistencia entre `GOOGLE_CLIENT_ID` (backend) y `VITE_GOOGLE_CLIENT_ID` (frontend),
  - validar que el dominio real esté en **Authorized JavaScript origins** en Google Cloud Console.
- **Impacto**: Alto
- **Dificultad**: Baja
- **Prioridad**: P0

### `docs/docker-production.md`
- **Pendiente recomendado**:
  - agregar checklist de Google Login en producción:
    - origin exacto (https + dominio),
    - client id único y consistente,
    - CORS backend alineado,
    - prueba post-deploy de login Google.
- **Impacto**: Alto
- **Dificultad**: Baja
- **Prioridad**: P0

---

## P1 — Flujo principal de negocio (captura y análisis)

## B) Nueva sesión: modularización + fiabilidad

### `frontend/src/pages/NewSession.tsx`
- **Problema**: archivo muy grande y con demasiadas responsabilidades.
- **Tareas**:
  1. extraer hooks (`useSessionTimer`, `useRestTimer`, `useVoiceCapture`, `useSessionDraft`),
  2. separar componentes (`ExerciseSetTable`, `SessionHeader`, `SessionWellness`, `SessionVoicePanel`),
  3. endurecer autosave + recuperación (snapshot transaccional),
  4. normalizar validaciones de reps/carga/esfuerzo.
- **Impacto**: Alto
- **Dificultad**: Alta
- **Prioridad**: P1

### `frontend/src/state/activeSession.tsx` + `frontend/src/state/undo.tsx`
- **Tareas**:
  - mover lógica de auditoría/undo a utilidades puras,
  - añadir límites y compresión de historial para evitar crecimiento no controlado.
- **Impacto**: Medio-Alto
- **Dificultad**: Media
- **Prioridad**: P1

### `frontend/src/lib/storage.ts`
- **Tareas**:
  - versionar esquema local (`schemaVersion`),
  - migración de drafts antiguos,
  - control de corrupción de localStorage con fallback limpio.
- **Impacto**: Medio
- **Dificultad**: Media
- **Prioridad**: P1

---

## C) Historial y valor visible

### `frontend/src/pages/History.tsx`
- **Tareas**:
  - filtros por rango de fecha/ejercicio,
  - KPIs de periodo (7/30/90 días),
  - comparativo contra periodo previo.
- **Impacto**: Alto
- **Dificultad**: Media
- **Prioridad**: P1

### `frontend/src/pages/RunDetail.tsx` + `frontend/src/components/ScenarioCard.tsx`
- **Tareas**:
  - panel de explicabilidad (prob/confianza/tradeoffs/levers) más claro,
  - CTA de “acción sugerida hoy” para bajar fricción de decisión.
- **Impacto**: Alto
- **Dificultad**: Media
- **Prioridad**: P1

---

## P1 — Backend robusto para iterar rápido

## D) Contrato y calidad API

### `frontend/src/api.ts` + `src/app/api/v1/endpoints/*`
- **Tareas**:
  - estandarizar error response (`code`, `detail`, `context`),
  - mapear códigos estables para UX amigable en frontend.
- **Impacto**: Alto
- **Dificultad**: Media
- **Prioridad**: P1

### `src/app/api/v1/endpoints/auth.py`
- **Tareas**:
  - registrar causa técnica controlada para fallos Google (sin exponer secretos),
  - mejorar detalle de errores 401/503 para diagnósticos de configuración.
- **Impacto**: Alto
- **Dificultad**: Baja
- **Prioridad**: P1

### `src/app/main.py`
- **Tareas**:
  - endpoint `/ready` con verificación DB + estado de migración actual,
  - mantener `/health` para liveness simple.
- **Impacto**: Alto
- **Dificultad**: Media
- **Prioridad**: P1

---

## P1 — Planning como diferenciador

## E) Ciclos y adherencia

### `src/app/planning/service.py`
- **Tareas**:
  - reglas de reconciliación más explícitas (warnings accionables),
  - indicadores de desviación por bloque/microciclo,
  - helpers puros para facilitar testeo.
- **Impacto**: Alto
- **Dificultad**: Alta
- **Prioridad**: P1

### `frontend/src/pages/Planning.tsx`
- **Tareas**:
  - vista de adherencia visual (completado, atrasos, próximo bloque),
  - reprogramación rápida sin perder trazabilidad.
- **Impacto**: Alto
- **Dificultad**: Media
- **Prioridad**: P1

---

## P2 — Observabilidad y evolución de producto

## F) Telemetría funcional

### `src/app/core/logging.py` + endpoints críticos
- **Tareas**:
  - logs estructurados por request_id, user_id (si existe), endpoint, latencia,
  - eventos de negocio: login_ok/login_fail, session_ingested, run_created.
- **Impacto**: Medio-Alto
- **Dificultad**: Media
- **Prioridad**: P2

### `frontend/src/pages/Home.tsx`
- **Tareas**:
  - panel de “estado operativo” (sin run reciente, sin medidas recientes, bloque atrasado),
  - CTAs de recuperación.
- **Impacto**: Medio
- **Dificultad**: Baja
- **Prioridad**: P2

---

## G) Voz offline (v2 incremental)

### `frontend/src/lib/voice/*` + `frontend/src/components/HoloVoiceAssistantOverlay.tsx`
- **Tareas**:
  - entrenamiento incremental por usuario (aliases/correcciones),
  - confirmación contextual opcional por comando aplicado,
  - fallback visual cuando la frase de activación no se reconoce.
- **Impacto**: Medio
- **Dificultad**: Media
- **Prioridad**: P2

---

## 30-60-90 (orden recomendado)

### Próximos 30 días
1. Cerrar Google Login estable (config + UX de errores + checklist deploy).
2. Contrato de errores API.
3. Modularizar `NewSession.tsx` (fase 1).

### Próximos 60 días
4. Timeline + KPIs en historial.
5. Explainability mejorada en run detail.
6. Planning con adherencia visible y reprogramación simple.

### Próximos 90 días
7. Observabilidad funcional completa.
8. Voz offline v2.
9. Panel coach multi-atleta con semáforos de riesgo.

---

## Checklist técnico rápido para Google Login (operativo)

1. Frontend tiene `VITE_GOOGLE_CLIENT_ID` correcto.
2. Backend tiene `GOOGLE_CLIENT_ID` idéntico.
3. Dominio exacto en Google Cloud Console → Authorized JavaScript origins.
4. Backend permite CORS desde el dominio frontend real.
5. Probar en navegador limpio (sin extensiones bloqueadoras) y en incógnito.
6. Revisar respuesta de `/api/v1/auth/google` y mensaje amigable en UI.

---

## Estado
- Documento creado para ejecución incremental.
- Incluye fix y estabilización del login con Google como prioridad P0.

## Avance aplicado (sesión actual)
- Login Google rehecho con botón oficial GSI y diagnóstico robusto.
- `CORS_ORIGINS` configurable por env (CSV/JSON) + documentación de deploy.
- Script `run_dev.ps1` para levantar `db+api` y validar health antes de frontend.
- `GET /ready` agregado (check DB + revisión de migración presente).
- Contrato de error backend unificado (`code`, `detail`, `context`) con handlers globales.
- Cliente frontend (`api.ts`) actualizado para leer `code/context` en errores.
- `NewSession.tsx` fase 1: extracción de lógica de temporizadores a `frontend/src/lib/session/timers.ts`.
- `History.tsx` fase 1: filtros de periodo (7/30/90 días) + KPIs de volumen y RPE promedio por ventana.
- `RunDetail.tsx` + `ScenarioCard.tsx`: acción sugerida del día + explicabilidad más clara por escenario.
- `Planning.tsx` (tracking): resumen operativo (total/activas/atraso/adherencia) + próximo bloque visible por asignación.
