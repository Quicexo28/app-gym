# Arquitectura funcional + Quick Wins

## 1) Visión de producto (resumen operativo)

Coach AI Engineer está orientado a **decisiones de entrenamiento asistidas**, no automatizadas. El sistema:

- captura datos de entrenamiento y contexto del atleta,
- procesa señales (métricas, tendencias, latentes),
- propone escenarios probabilísticos explicables,
- deja la decisión final en el coach/usuario.

En términos funcionales, el producto combina:

1. **Capa operativa diaria** (sesiones, historial, medidas, rutinas),
2. **Capa de planificación por ciclos** (micro/meso/macro + adherencia),
3. **Capa de inteligencia** (trends + latents + suggestions + runner e2e versionado).

---

## 2) Arquitectura end-to-end (usuario → API → DB → motor → UI)

## 2.1 Frontend (React + TypeScript + Vite)

### Flujo principal de usuario
- Login/Register (`/login`) con email/teléfono o Google.
- Entrada al `AppShell` con navegación por rol/modo (user/coach/admin).
- Operación diaria:
  - `Nueva sesión` (`/session/new`) para registrar sets/carga/reps/esfuerzo,
  - `Historial` (`/history`),
  - `Medidas` (`/measurements`),
  - `Rutinas` (`/routines`),
  - `Planificación` (`/planning`).

### Estados transversales
- `auth`: sesión y token.
- `athlete`: sujeto activo y alcance (self/assigned).
- `viewMode`: modos permitidos según rol/plan.
- `preferences`: tema, unidades, escala de esfuerzo.
- `activeSession` + `undo`: UX en captura de sesión.

### Voz offline (V1)
- En `Nueva sesión` existe captura de voz on-device con `vosk-browser`.
- Wake phrase + parser de comandos acotados (peso/reps/rpe/completar).
- Objetivo actual: acelerar carga de datos sin subir audio al servidor.

---

## 2.2 Backend API (FastAPI)

Base: `/api/v1`.

### Capas del backend
1. **API layer** (`app/api/v1/endpoints/*`)
   - Expone contratos HTTP y validaciones de request/response.
2. **Servicios / dominio app** (`app/planning/service.py`, módulos de perfil, auth helpers)
   - Regla de negocio de ciclos, asignaciones, consistencia funcional.
3. **Persistencia** (`app/db/models*.py`, `repo.py`, SQLAlchemy)
   - Mapeo relacional y operaciones de almacenamiento.
4. **Motor científico** (`src/coach_ai/*`)
   - Pipeline determinista por etapas para señales y escenarios.

### Endpoints clave (nivel funcional)
- **Meta/Health:** `/health`, `/meta/ping`
- **Auth:** register/login/google/guest (guest no prod)
- **Sujetos y acceso:** atletas asignados, modo de vista
- **Sesiones:** ingesta batch, historial relacionado
- **Runs:** ejecución e2e + consulta de resultados
- **Body metrics:** mediciones antropométricas
- **Planning:** templates micro/meso/macro + assignments + bloques
- **Admin/Profile/Settings:** soporte operativo y configuración

---

## 2.3 Base de datos (PostgreSQL)

## Entidades funcionales principales
- `users`, `user_settings` (auth, rol, plan, módulos)
- `athletes`, `coach_athlete_assignments` (acceso coach↔atleta)
- `sessions` (entrenamientos crudos + métricas derivadas cacheadas)
- `runs` (salida del motor + resumen + configuración/fingerprint)
- `exercise_catalog` (global/custom)
- `body_measurements` (progreso antropométrico)
- `cycle_templates`, `micro_template_blocks`, `cycle_template_links`
- `cycle_assignments`, `cycle_assignment_blocks` (ejecución y adherencia)

## Propiedad de diseño
- Persistencia preparada para longitudinalidad (seguimiento real en el tiempo).
- Índices/constraints orientados a consistencia (ej. unicidad sesión atleta+inicio).

---

## 2.4 Motor de decisiones (coach_ai)

Pipeline lógico:

1. `training_core`
   - schema/validación, normalización individual, métricas base
2. `trends`
   - suavizado + derivadas + clasificación de tendencia
3. `latents`
   - estados latentes (fatiga/readiness/plateau) con confianza
4. `suggestions`
   - escenarios con probabilidad, tradeoffs y levers
5. `e2e.runner`
   - orquestación completa + logging JSONL + versionado/fingerprint

## Propiedad de diseño
- Explicabilidad: no “caja negra”, sino heurísticas trazables.
- Probabilístico: comunica incertidumbre, no certeza ficticia.
- Auditable: versión/config/resultado persistidos.

---

## 3) Estética y lenguaje de interfaz

## Estética actual
- **Minimal clean dashboard**: cards, chips, densidad contenida.
- Palette sobria con acento verde/teal (salud/rendimiento).
- Tema light/dark consistente por tokens CSS.
- Navegación simple en barra superior + menú “Más”.

## Lenguaje de producto
- Español orientado a operación rápida (“Nueva sesión”, “Planificación”, “Historial”).
- Mensajes de estado directos, sin ruido narrativo.
- Tono técnico-práctico, no “fitness motivacional genérico”.

Conclusión estética: la app está bien orientada a **herramienta de trabajo de coach**, no red social ni app gamificada agresiva.

---

## 4) Objetivo y dirección evolutiva

La dirección más coherente que ya muestra el código es:

1. consolidar el flujo de captura diaria (fricción mínima),
2. robustecer planning con adherencia real,
3. elevar calidad de señal (datos + confianza),
4. traducir el motor en decisiones accionables y comprensibles.

En una frase: **de registro operativo → a sistema de soporte de decisiones confiable y explicable**.

---

## 5) Quick Wins priorizados (impacto alto / bajo riesgo)

> Escala: P1 (inmediato), P2 (siguiente iteración), P3 (optimización).

## P1 — UX y continuidad operativa

1. **Wizard de primera sesión (onboarding guiado 60s)**
   - Qué: flujo inicial para dejar listo sujeto, unidades, rutina base, esfuerzo.
   - Impacto: reduce abandono inicial y tickets de “no sé por dónde empezar”.

2. **Estado vacío inteligente en Dashboard / Historial / Planning**
   - Qué: CTAs contextuales cuando no hay datos.
   - Impacto: evita pantallas muertas y acelera primer valor.

3. **Autosave robusto en Nueva sesión + recuperación tras recarga**
   - Qué: snapshot local periódico + aviso claro de recuperación.
   - Impacto: evita pérdida de registro durante entrenamiento real.

4. **Validación unificada de inputs críticos (reps/carga/esfuerzo)**
   - Qué: reglas visuales + mensajes consistentes frontend/backend.
   - Impacto: menor ruido de datos y menos errores de ingestión.

## P1 — Fiabilidad técnica

5. **Healthcheck extendido /ready con chequeo DB y versión de schema**
   - Qué: endpoint listo para monitoreo real de deploy.
   - Impacto: detección temprana de incidentes post-migración.

6. **Contrato de errores API estandarizado**
   - Qué: formato único (`code`, `detail`, `context`) en todos los endpoints.
   - Impacto: frontend más simple + debugging más rápido.

7. **Cobertura de tests en endpoints críticos (auth/sessions/planning)**
   - Qué: batería mínima de integración para rutas de negocio.
   - Impacto: evita regresiones al acelerar nuevas features.

---

## P2 — Señal y decisión

8. **Run explainability panel en UI**
   - Qué: mostrar por escenario: probabilidad, confianza, tradeoffs, levers.
   - Impacto: convierte salida técnica en decisión utilizable por coach.

9. **Timeline unificado atleta (sesiones + medidas + hitos de planning)**
   - Qué: vista cronológica única para contexto longitudinal.
   - Impacto: lectura estratégica más rápida.

10. **Alertas de calidad de datos (faltantes/inconsistencias)**
    - Qué: avisos no bloqueantes antes de correr análisis.
    - Impacto: sube confiabilidad sin frenar operación.

11. **KPIs de adherencia por ciclo y por bloque**
    - Qué: % bloques cumplidos, desviación temporal, rachas.
    - Impacto: planning deja de ser estático y pasa a ser gestionable.

---

## P3 — Diferenciadores

12. **Personalización adaptativa de la voz (wake aliases + vocabulario usuario)**
    - Qué: entrenamiento incremental de parser con perfil local.
    - Impacto: menor fricción en entorno real de gym.

13. **Plantillas de microciclo por objetivo (fuerza/hipertrofia/recomposición)**
    - Qué: presets reutilizables con bloques sugeridos.
    - Impacto: acelera setup de coaches nuevos.

14. **Observabilidad funcional (embudo de uso)**
    - Qué: métricas de uso por etapa (captura → run → revisión).
    - Impacto: priorización de roadmap basada en comportamiento real.

---

## 6) Recomendación de foco inmediato (2 semanas)

Si buscas máxima tracción sin dispersión:

- Semana 1: P1-1, P1-2, P1-3, P1-6
- Semana 2: P1-5, P1-7, P2-8

Resultado esperado:
- UX más robusta en operación diaria,
- menos fricción de captura,
- backend más estable para iterar,
- primera capa visible de valor del motor hacia decisiones.

---

## 7) Criterios de éxito (medibles)

- ↓ abandono en primera sesión creada
- ↓ errores de validación por sesión
- ↑ sesiones completas por usuario activo
- ↑ runs consultados tras registro de sesión
- ↑ adherencia de bloques en planning
- ↓ incidentes por migración/deploy

---

## 8) Riesgos a vigilar

- Migraciones no consolidadas pueden frenar ritmo de release.
- Diferencias de contrato FE/BE si no se unifica manejo de errores.
- Sobrecargar UI con “IA” sin contexto puede reducir confianza del coach.
- Aumentar features sin observabilidad puede ocultar qué realmente aporta valor.

---

## 9) Decisión estratégica recomendada

Mantener la identidad de producto como:

**“Sistema operativo de entrenamiento para coaches y atletas, con motor probabilístico explicable para tomar mejores decisiones.”**

Esa definición alinea bien la base actual (arquitectura + estética + dominio) y evita desvíos hacia features vistosas pero poco útiles.
