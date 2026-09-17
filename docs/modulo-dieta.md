# Módulo de Dieta — Especificación de implementación

Documento de referencia para el módulo de alimentación de Alzo. Define modelo de
datos, contratos de API, flujos de captura y reglas de UI. **Toda la
implementación debe apegarse al diseño actual de la app**: sin librerías de UI
nuevas, sin literales de color, reutilizando las clases y tokens existentes de
`frontend/src/styles.css`.

---

## 1. Decisiones de arquitectura

| Tema | Decisión |
| --- | --- |
| Fuente externa de alimentos | **Open Food Facts** (única fuente remota). Lookup por código de barras + búsqueda por texto. |
| OCR de tabla nutricional | **On-device** (`@capacitor-mlkit/text-recognition`) en Android. El parser es propio y vive en el frontend. La interfaz es *pluggable* para enchufar Claude API vision más adelante sin tocar la UI. |
| Fotos de empaque | Se **guardan** junto al producto en el servidor (volumen `media`), reencodificadas a JPEG. |
| Alimentos personalizados | Misma tabla que el catálogo global, discriminados por `owner_user_id` (patrón idéntico a `ExerciseCatalog`). |
| Expansión de mercado | `country_code` nullable en el catálogo. `NULL` = global. Hoy se prioriza `CO`. |

### Fuera de alcance (registrado para el futuro)

- **INVIMA**: su registro sanitario no publica información nutricional, solo
  estado de registro. No es una fuente viable de macros/micros.
- **USDA FoodData Central**: fallback útil cuando se abra mercado en EE.UU.
- **Claude API vision** para OCR: enchufar en `OcrProvider` cuando se decida.

---

## 2. Modelo de datos

Todo en `src/app/db/models.py`, siguiendo el estilo del archivo (SQLAlchemy 2.0
`Mapped` / `mapped_column`, UUID primary keys, `created_at_utc` con `now_utc`).

### 2.1 `food_products` — catálogo compartido + alimentos personalizados

Un solo modelo cubre el catálogo global y los alimentos personalizados, igual que
`ExerciseCatalog`: `owner_user_id IS NULL` ⇒ global/compartido;
`owner_user_id IS NOT NULL` ⇒ personal de ese usuario.

```
id                  UUID pk
owner_user_id       UUID fk users.id  nullable  index   -- NULL = catálogo compartido
barcode             String(64)  nullable  index          -- EAN-8/13, UPC-A/E
source              String(24)  not null                 -- off | user_photo | user_manual
source_ref          String(128) nullable                 -- código OFF u otro id externo
name                String(300) not null
brand               String(200) nullable
country_code        String(2)   nullable                 -- 'CO'; NULL = global
category            String(80)  nullable  index          -- grupo del catálogo de origen (TCAC); NULL si no aplica
serving_size_g      Float       nullable                 -- gramos de UNA porción
serving_label       String(120) nullable                 -- "1 taza (30 g)"
package_qty_g       Float       nullable

basis               String(12)  not null default 'per_100g'   -- per_100g | per_100ml

-- Macros SIEMPRE normalizados a 100 g/ml. Columnas explícitas.
energy_kcal         Float nullable
protein_g           Float nullable
carbs_g             Float nullable
sugars_g            Float nullable
fiber_g             Float nullable
fat_g               Float nullable
sat_fat_g           Float nullable
trans_fat_g         Float nullable
sodium_mg           Float nullable
cholesterol_mg      Float nullable

-- Micronutrientes: JSON keyed por el registro canónico (sección 3).
micronutrients      JSON  nullable   -- {"vitamin_c_mg": 12.0, "calcium_mg": 120}

image_front_path    String(300) nullable
image_nutrition_path String(300) nullable

verified_count      Integer not null default 0
status              String(16) not null default 'active'  -- active | pending | rejected
created_by_user_id  UUID fk users.id nullable
created_at_utc      DateTime(tz)
updated_at_utc      DateTime(tz)
```

Índices (misma técnica de índice parcial que `ExerciseCatalog`):

```python
Index("ix_food_products_global_barcode", "barcode", unique=True,
      postgresql_where=text("owner_user_id IS NULL AND barcode IS NOT NULL"))
Index("ix_food_products_owner_name", "owner_user_id", "name")
Index("ix_food_products_name_search", "name")
```

**El barcode es único solo en el catálogo global.** Un alimento personalizado
puede repetir un barcode sin romper nada.

### 2.2 `meal_entries` — registro de comidas

```
id                UUID pk
athlete_id        String fk athletes.athlete_id  index
logged_by_user_id UUID fk users.id  index
consumed_at       DateTime(tz) not null index
meal_slot         String(16) not null      -- desayuno | almuerzo | cena | snack
food_product_id   UUID fk food_products.id nullable   -- NULL si fue ad-hoc

-- SNAPSHOT congelado al momento de registrar.
food_name         String(300) not null
quantity_g        Float not null           -- NORMALIZADA a la unidad base (g, o ml si basis=per_100ml)
quantity_value    Float nullable           -- lo que escribió el usuario: 2
quantity_unit     String(16) nullable      -- ...en qué unidad: "porcion"
energy_kcal       Float nullable
protein_g         Float nullable
carbs_g           Float nullable
sugars_g          Float nullable
fiber_g           Float nullable
fat_g             Float nullable
sat_fat_g         Float nullable
sodium_mg         Float nullable
micronutrients    JSON nullable
notes             Text nullable
created_at_utc    DateTime(tz)

Index("ix_meal_entries_athlete_consumed", "athlete_id", "consumed_at")
```

> **Regla crítica:** los valores nutricionales del registro son un *snapshot
> absoluto para la cantidad consumida*, no una referencia viva al catálogo. Si
> mañana alguien corrige el producto en el catálogo, el historial **no** debe
> cambiar. Esto no es negociable.

#### Unidades de cantidad

La cantidad se registra en la unidad que le sirva al usuario (g, kg, oz, lb,
ml, L, oz líq., taza, cucharada, cucharadita, porción) y **el backend
convierte**: es el único que conoce el `serving_size_g` del catálogo, que es el
factor de `porcion`. `quantity_g` sigue siendo el único valor que entra en la
aritmética de macros; `quantity_value` + `quantity_unit` guardan lo escrito
para poder mostrarlo y reeditarlo igual ("2 porciones", no "90 g").

La tabla de conversión vive en `app/nutrition/units.py`, con espejo exacto en
`frontend/src/lib/nutrition/units.ts` (el front solo la usa para poblar el
selector y previsualizar sin red). Reglas:

- `POST/PATCH /diet/entries` aceptan `quantity_value` + `quantity_unit`
  (viajan juntos o es 422) **o** `quantity_g` a secas. Si vienen los dos, manda
  el par: así un cliente desactualizado no puede escribir un `quantity_g` que
  no cuadre con la unidad.
- Sin unidad se asume la base del alimento — `g`, o `ml` si es `per_100ml` —,
  que es lo que mandaban los clientes previos a este cambio. Las entradas
  viejas tienen las dos columnas en NULL y se siguen mostrando en gramos.
- El tope de 5000 se aplica **después** de convertir: "6" no dice nada, 6 kg sí
  se pasa.
- `porcion` solo existe si el alimento declara `serving_size_g`. Sin ese dato
  el selector no la ofrece y el backend la rechaza con 422 en vez de inventar
  un factor.
- Las unidades de volumen sobre un sólido asumen densidad 1 (1 ml → 1 g). Es
  una estimación deliberada: quien elige "taza" no está pesando.

### 2.3 `meal_presets` — comidas preestablecidas

```
id             UUID pk
owner_user_id  UUID fk users.id index
name           String(200) not null
meal_slot      String(16) nullable
items          JSON not null    -- [{food_product_id, food_name, quantity_g, <snapshot nutricional por item>}]
created_at_utc / updated_at_utc

Index("ix_meal_presets_owner_name", "owner_user_id", "name", unique=True)
```

### 2.4 `nutrition_targets` — objetivos diarios

```
id                     UUID pk
athlete_id             String fk athletes.athlete_id  unique
energy_kcal            Float nullable
protein_g / carbs_g / fat_g / fiber_g   Float nullable
micronutrient_targets  JSON nullable   -- overrides sobre los RDA por defecto
updated_at_utc         DateTime(tz)
```

---

## 3. Registro canónico de micronutrientes

Vive en `src/app/nutrition/micronutrients.py` como única fuente de verdad y se
expone por API para que el frontend no duplique la tabla.

Cada entrada: `key`, `label` (español), `unit`, `rda` (referencia adulto),
`upper_limit` (nullable). Claves y unidades fijas:

```
vitamin_a_ug, vitamin_c_mg, vitamin_d_ug, vitamin_e_mg, vitamin_k_ug,
thiamin_mg, riboflavin_mg, niacin_mg, vitamin_b6_mg, folate_ug, vitamin_b12_ug,
calcium_mg, iron_mg, magnesium_mg, phosphorus_mg, potassium_mg, zinc_mg,
copper_mg, manganese_mg, selenium_ug, iodine_ug
```

**Trampa número uno:** Open Food Facts entrega casi todos los micronutrientes y
el sodio **en gramos**. Nosotros almacenamos en mg/µg. La conversión debe estar
centralizada en un solo mapa y cubierta por tests. Un error aquí produce valores
1000× equivocados y pasa desapercibido en la UI.

---

## 4. Cliente Open Food Facts

`src/app/nutrition/off_client.py` — usa `httpx` (ya es dependencia).

- Base: `https://world.openfoodfacts.org`
- Producto: `GET /api/v2/product/{barcode}.json?fields=...`
  - Respuesta con `status: 0` ⇒ producto no encontrado (no es un error HTTP).
- Búsqueda: `GET /api/v2/search?...&page_size=20`
- **User-Agent obligatorio** por política de OFF: `Alzo/1.0 (santiagoquicenoqp@gmail.com)`
- Timeout 8 s. Cualquier fallo de red degrada con elegancia: se devuelve el
  resultado local y nunca se propaga una excepción al usuario.
- Límites de OFF: ~100 req/min para producto, ~10 req/min para búsqueda.
- **Caché:** todo producto traído de OFF se hace upsert en `food_products` con
  `source='off'`. Las siguientes consultas del mismo barcode salen de Postgres,
  no de la red.

Mapeo `nutriments` → columnas (todos los `_100g`):

| OFF | Nuestro | Conversión |
| --- | --- | --- |
| `energy-kcal_100g` | `energy_kcal` | directa |
| `proteins_100g` | `protein_g` | directa |
| `carbohydrates_100g` | `carbs_g` | directa |
| `sugars_100g` | `sugars_g` | directa |
| `fiber_100g` | `fiber_g` | directa |
| `fat_100g` | `fat_g` | directa |
| `saturated-fat_100g` | `sat_fat_g` | directa |
| `trans-fat_100g` | `trans_fat_g` | directa |
| `sodium_100g` | `sodium_mg` | **× 1000** |
| `cholesterol_100g` | `cholesterol_mg` | **× 1000** |
| `vitamin-c_100g` | `vitamin_c_mg` | **× 1000** |
| `vitamin-a_100g` | `vitamin_a_ug` | **× 1 000 000** |
| `calcium_100g`, `iron_100g`, … | `*_mg` | **× 1000** |
| `folate_100g`, `vitamin-b12_100g`, `selenium_100g`, `iodine_100g`, `vitamin-d_100g`, `vitamin-k_100g` | `*_ug` | **× 1 000 000** |

Si falta `energy-kcal_100g` pero existe `energy-kj_100g`: `kcal = kJ / 4.184`.

---

## 5. API — `/api/v1/diet`

Nuevo archivo `src/app/api/v1/endpoints/diet.py`, registrado en
`src/app/api/v1/router.py`. Todos los endpoints con `athlete_id` usan la
dependencia existente `require_athlete_access`.

```
GET    /diet/targets?athlete_id=
PUT    /diet/targets

GET    /diet/entries?athlete_id=&date=YYYY-MM-DD     -> entradas del día + totales
POST   /diet/entries
PATCH  /diet/entries/{id}
DELETE /diet/entries/{id}
POST   /diet/entries/from-preset

GET    /diet/summary?athlete_id=&from=&to=           -> serie de totales diarios (gráficas)

GET    /diet/foods/search?q=&scope=all|mine|global&limit=
GET    /diet/foods/barcode/{barcode}                 -> local -> OFF -> 404
POST   /diet/foods
PATCH  /diet/foods/{id}
DELETE /diet/foods/{id}
POST   /diet/foods/{id}/photos                       -> multipart (front | nutrition)
GET    /diet/foods/{id}/photos/{kind}

GET    /diet/micronutrients                          -> registro + RDA
GET    /diet/presets
POST   /diet/presets
DELETE /diet/presets/{id}
```

### Reglas de autorización

- Registros de comida: solo accesibles vía `require_athlete_access`. Un usuario
  jamás puede leer ni escribir el diario de otro.
- `PATCH`/`DELETE` sobre `/diet/foods/{id}`: permitido únicamente si
  `owner_user_id == current_user.id`. Los productos globales solo los edita un
  admin.
- Contribución al catálogo compartido: un producto con barcode aportado por un
  usuario entra con `status='pending'` pero **es visible para todos**, marcado
  como «sin verificar» en la UI. `verified_count` sube cuando otro usuario lo
  confirma. Sin esto, el requisito de «agregar a la base de datos para futuros
  usuarios» quedaría bloqueado tras una cola de aprobación manual.

### Fotos

- Config nueva `MEDIA_ROOT` en `src/app/core/config.py` (default `/app/media`).
- Volumen `coach_ai_media` montado en `/app/media` en `docker-compose.yml` y
  `docker-compose.prod.yml`.
- Subida: multipart, máximo 6 MB, se valida el content-type **y los magic bytes**.
- La imagen se reencodifica con **Pillow** a JPEG, borde máximo 1600 px. Esto
  descarta EXIF (privacidad: las fotos de empaque pueden traer GPS) y neutraliza
  archivos poliglotas.
- Ruta en disco: `MEDIA_ROOT/food/{product_id}/{front|nutrition}.jpg`. **El
  nombre de archivo nunca se deriva de datos del cliente.**
- Agregar `pillow>=10.0` a las dependencias en `pyproject.toml`.

---

## 6. Frontend

### 6.1 Rutas — hub con 2 pestañas

La app usa 5 pestañas fijas abajo; `Dieta` ya es una de ellas. Dentro, se usa
`HubTabs` como el resto de hubs. Se mantiene mínimo a propósito:

```
/diet            -> Diario      (index)
/diet/alimentos  -> Alimentos   (búsqueda, personalizados, preestablecidas)
/diet/nutricion  -> detalle nutricional (ruta empujada, NO es pestaña)
/diet/agregar    -> flujo de captura (ruta empujada, NO es pestaña)
/diet/historial  -> histórico 7/30/90 días (ruta empujada, NO es pestaña)
```

`Objetivos` dejó de ser pestaña: se ajusta desde `/diet/nutricion`, la pantalla
que se abre al pulsar la card de resumen del día. `/diet/objetivos` redirige
allí. Esa pantalla tiene dos apartados grandes, **Diario** y **Semanal** (los 7
días que terminan en el día seleccionado), más el editor de objetivos: con 3 de
los 4 valores (kcal, proteína, carbos, grasa) el cuarto se calcula despejando
`kcal = 4P + 4C + 9G` (`solveMissingMacro` en `lib/nutrition/dietApi.ts`).

Los nombres de las comidas se editan en línea desde cada bloque del Diario
(kebab → Renombrar / Vaciar este día / Eliminar comida, y `+ Agregar comida`),
persistiendo en `NutritionTarget.meal_labels`. Sin `meal_labels` configurados,
el default son 3 comidas genéricas (`Comida 1..3`).

### 6.2 Componentes de gráficas — extraer y compartir

`Home.tsx` define hoy `ProgressRing` y `MacroBar` localmente, con ceros
hardcodeados. **Se extraen a `frontend/src/components/NutritionCharts.tsx`** y
tanto Home como Dieta consumen la misma implementación. Home deja de mostrar
ceros y pasa a leer los totales reales del día.

Componentes:

- `ProgressRing` — anillo de kcal. Movido tal cual, sin cambios visuales.
- `MacroBar` — barra de macro. Movida tal cual (`.macroRow`, `.barTrack`,
  `.barFill`, `macro-*`).
- `MicroBar` — **nuevo**. Barra más delgada para micronutrientes.

### 6.3 `MicroBar` — estados de color

Barra de 5 px de alto (frente a los 8 px de `.barTrack`). Clase nueva
`.microTrack` / `.microFill` en `styles.css`, siguiendo el estilo del archivo.
El color sale del porcentaje alcanzado sobre el objetivo:

| Estado | Rango | Color | Clase |
| --- | --- | --- | --- |
| Muy bajo | < 50 % | `var(--danger)` | `.microFill.veryLow` |
| Bajo | 50–79 % | neutro claro `color-mix(in srgb, var(--text-soft), var(--border) 40%)` | `.microFill.low` |
| Bueno | 80–150 % | `var(--accent)` (verde) | `.microFill.good` |
| Excedido | > 150 % y el micro tiene `upper_limit` | `color-mix(in srgb, var(--danger), var(--accent) 35%)` | `.microFill.over` |

El estado «bajo» usa un neutro que se lee blanco sobre el tema oscuro y gris
sobre el claro — que es justo el comportamiento pedido, sin romper el tema claro
ni introducir un `#fff` literal.

`over` solo aplica a micronutrientes con `upper_limit` definido (sodio, hierro,
vitamina A…). Para el resto, todo lo que supere el objetivo se queda en `good`.

### 6.4 Gráficas del apartado

- **Hoy**: anillo de kcal + 3 `MacroBar` (idéntico a Home) + rejilla de
  `MicroBar` para los micronutrientes con datos.
- **Tendencia**: kcal de los últimos 7/30 días con el `BarChart` que ya existe
  en `frontend/src/components/Charts.tsx`. No se crea otro tipo de gráfica.
- **Home**: la card de dieta consume `GET /diet/entries?date=hoy` y pinta datos
  reales. Sin ceros hardcodeados.

### 6.5 Captura de alimentos

`frontend/src/lib/nutrition/`:

- `barcode.ts` — escaneo. `@capacitor-mlkit/barcode-scanning` en nativo;
  `BarcodeDetector` en web si el navegador lo soporta; entrada manual como
  último recurso. Detección de capacidad, nunca asumir que existe.
- `ocr.ts` — interfaz `OcrProvider { recognize(image): Promise<string[]> }`.
  Implementación `MlKitOcrProvider` (nativo). En web, si no hay proveedor, se cae
  directo al formulario manual. La interfaz existe para enchufar Claude API
  después sin tocar la UI.
- `labelParser.ts` — **función pura**, sin red, sin dependencias. Recibe líneas
  de texto y devuelve nutrición parseada + nivel de confianza por campo.

#### Requisitos del parser de etiquetas

Etiquetas colombianas reales. Debe manejar:

- **Coma decimal** (`12,5` = 12.5). Es el separador estándar en Colombia.
- Encabezados: `Tamaño de porción`, `Porciones por envase`, `Información
  nutricional`.
- Campos: `Energía` / `Calorías`, `Grasa total`, `Grasa saturada`, `Grasas
  trans`, `Colesterol`, `Sodio`, `Carbohidratos totales`, `Fibra dietaria`,
  `Azúcares`, `Azúcares añadidos`, `Proteína`.
- **kJ y kcal juntos** en la misma línea — hay que quedarse con kcal.
- Doble columna «por porción» / «por 100 g» — hay que saber cuál se está leyendo
  y normalizar todo a 100 g antes de guardar.
- `%VD` / `%VR` presentes en la línea: son ruido, se descartan.
- Micronutrientes cuando aparezcan al pie de la tabla.

#### Flujo de captura completo

```
Escanear código de barras
        │
        ├── Encontrado (local u OFF) ──> confirmar cantidad ──> registrar
        │
        └── No encontrado
                 │
                 └──> Registro por foto
                        · foto frontal (nombre/marca)
                        · foto posterior (tabla nutricional) ──> OCR ──> parser
                        · formulario prellenado, SIEMPRE editable por el usuario
                        │
                        ├── barcode visible/conocido ──> se guarda en el catálogo
                        │    compartido (status pending, visible para todos)
                        │
                        └── sin barcode ──> alimento personalizado del usuario,
                             con opción explícita de añadir el código después
```

Regla de UX: el OCR **propone**, nunca decide. Todo campo reconocido llega al
formulario editable y marcado como sugerencia. Un OCR equivocado que se guarda en
silencio contamina el catálogo compartido de todos los usuarios.

### 6.6 Offline — y por qué necesita idempotencia

Registrar una comida sin conexión se encola y sincroniza al reconectar,
siguiendo el patrón de `frontend/src/lib/sessionOutbox.ts`. La búsqueda en OFF y
el escaneo requieren red y degradan con un mensaje claro.

Pero el patrón no se puede copiar tal cual. `sessionOutbox.ts` dice en su propio
comentario: «El backend deduplica por (athlete_id, start_time), así que
reintentar el mismo payload es seguro». **Para comidas esa garantía no existe.**

Además, `isNetworkError()` devuelve `true` para todo lo que no sea `ApiError` —
incluido un timeout que ocurre *después* de que el servidor ya hizo commit. Es
entrega at-least-once: sin idempotencia, el reintento duplica la comida en el
diario. No es un caso teórico.

Solución:

- `meal_entries.client_ref` (String(64), nullable), con índice único parcial por
  atleta: `Index(..., "athlete_id", "client_ref", unique=True,
  postgresql_where=text("client_ref IS NOT NULL"))`.
- `POST /diet/entries` acepta `client_ref` opcional. Si ya existe una entrada con
  ese `(athlete_id, client_ref)`, **devuelve la existente** en vez de crear otra.
  Sin `client_ref`, el comportamiento no cambia.
- **El `client_ref` se genera al encolar, no al enviar.** Generarlo al enviar
  haría que cada reintento mande uno distinto y la idempotencia no serviría de
  nada. Es el punto central del diseño.
- Error de red → encola. Error del servidor (`ApiError`) → no encola, se muestra.

---

## 7. Métricas de calidad — criterios de aceptación

Ninguna fase se da por terminada sin esto.

1. **Tests backend**: `pytest` en verde. Mínimo **25 tests nuevos** que cubran:
   conversión de unidades OFF→canónico (el error 1000×), aritmética
   porción↔100 g, agregación de totales diarios, aislamiento de acceso (el
   usuario A no puede leer el diario del B), validación de subida de fotos.
2. **Parser de etiquetas**: ≥ **90 %** de extracción correcta sobre un set de
   **≥ 10 textos reales** de etiquetas colombianas. Campos obligatorios: kcal,
   proteína, carbohidratos, grasa. Tests unitarios, sin red.
3. **Typecheck y lint limpios**: `npm run lint` y `tsc -b` sin errores;
   `ruff check` y `ruff format --check` limpios.
4. **Cero placeholders**: no queda ningún cero hardcodeado en la card de dieta de
   Home. Home y Dieta leen del mismo origen de datos.
5. **Conformidad de diseño**: **cero literales de color nuevos** — todo vía las
   variables CSS existentes. Sin dependencias de UI nuevas. Nombres de clase
   siguiendo la convención del archivo.
6. **Offline**: registrar una comida sin conexión encola y sincroniza al volver.
7. **Seguridad**: imágenes reencodificadas con Pillow y con tope de tamaño; la
   ruta en disco nunca se deriva de entrada del cliente; `require_athlete_access`
   en todos los endpoints con `athlete_id`.
8. **Bundle web**: incremento máximo de **150 KB** gzip. ML Kit es solo nativo,
   así que la web no debe engordar.

---

## 8. Fase extra — TCAC / ICBF (alimentos genéricos colombianos)

Cubre lo que Open Food Facts no puede cubrir: alimentos sin código de barras
(arepa, panela, arracacha, bocachico, guanábana, mazamorra). Es el diferenciador
real para el mercado colombiano.

### 8.1 Qué se investigó y qué se descartó

| Vía | Resultado |
| --- | --- |
| API pública de datos abiertos | **No existe.** No hay dataset TCAC en `datos.gov.co` con acceso programático. |
| API del portal TCAC del ICBF | **Descartada.** `https://capacitacion.icbf.gov.co/WebApiTCAC/api/` existe, pero exige login (`LoginUsuario`/`ValidarUsuario`) y el bundle declara `production: false` — es entorno de capacitación/pruebas, no una API pública estable. |
| PDF oficial TCAC 2018 | **Única fuente viable.** `https://www.icbf.gov.co/sites/default/files/tcac_web.pdf` — 147 páginas, 16,7 MB, 773 alimentos. |

### 8.2 Realidad del PDF (medido, no supuesto)

- Es **100 % imágenes**. `pdftotext` sobre las 147 páginas devuelve 147 caracteres
  en total (solo saltos de página). Cero texto extraíble.
- Imágenes JPEG de 831×831 px a 96 ppi. Resolución baja para tablas numéricas
  densas.
- El PDF viene con `copy:no` (restricción de copia AES).

Prueba de OCR con Tesseract sobre la página 45 renderizada a 300 dpi: la
estructura de la tabla se reconoce bien, pero hay dos clases de error graves:

1. **Se pierde la coma decimal** en buena parte de los valores. `12,0` sale como
   `120`; `80,0` como `800`; `77,6` como `776`. Sin corregir, esto convierte
   80 g de carbohidratos en 800 g.
2. **Confusión de caracteres**: `A029`→`AD29`, `9,1`→`a1`, `11,4`→`M4`,
   `9,6`→`06`, `358`→`388`, `1517`→`15177`.

Tampoco está instalado el paquete de idioma español de Tesseract (solo `eng` y
`osd`), lo que degrada los nombres de alimentos con tildes.

**Limpieza posterior de nombres (2026-09-17, migración `c4f1b7e09a52`).** Los
nombres sembrados llegaron con esos errores a la UI ("AQueso fresco…",
"Ajonjoll o sésamo", "Aceitedeoiva", "Guarapo de caha de azúcar"). La migración
corrige 180 nombres donde el alimento se identifica sin ambigüedad — el OCR
cambia siempre lo mismo: `ó`→`d`/`é`, `a`→`s` al final de palabra, `rn`→`m`,
`ll`→`li`, `ñ`→`fi`/`h`, tildes comidas y espacios comidos — y **borra 26 filas
ilegibles** (`Immmw.nmm`, `IFI3I.Iemera.canel.emda`, …) donde no hay forma de
saber qué alimento era. El catálogo TCAC queda en 607 alimentos. Las comidas ya
registradas que apuntaban a una fila borrada conservan su nombre y macros: solo
se les suelta el `food_product_id`. Los valores numéricos no se tocan (siguen
respaldados por el gate de las tres invariantes, sec. 8.3).

**Conclusión: no es un "corre OCR y listo".** Es un ETL con solucionador de
validación. Se asume así.

### 8.3 Lo que hace viable la extracción: tres invariantes de la tabla

La TCAC trae redundancia suficiente para auto-verificar cada fila:

1. **Energía**: `kJ ≈ kcal × 4,184` (tolerancia **±2 %**). La tabla trae ambas
   columnas, así que cada fila lleva su propio checksum.
2. **Balance de masa**: `humedad + proteína + lípidos + carbohidratos totales +
   cenizas ≈ 100 g` (tolerancia ±2 g). Es el invariante más fuerte.
3. **Atwater**: `kcal ≈ 4×proteína + 4×carbohidratos disponibles + 9×lípidos`.
   **Señal de apoyo, NO gate.** Ver nota abajo.

> **Tolerancias corregidas tras medir sobre datos reales.** La primera versión de
> este documento fijó ±1 % para energía y ±10 % para Atwater. Ambas resultaron
> mal calibradas al contrastarlas con el JSON extraído:
>
> - Energía a ±1 % fallaba en 181/327 filas; a ±2 % falla en 2. La TCAC redondea
>   las kcal a entero, así que ±1 % es ruido de redondeo, no error de dato.
> - Atwater a ±10 % fallaba en 151/327, pero la desviación **mediana** de las
>   filas sanas es 11,5 % y el p90 llega a 30 %. Los factores de Atwater son
>   aproximaciones: fibra, polioles, ácidos orgánicos y los factores específicos
>   por grupo de alimento que usa la TCAC desplazan el resultado. Como gate duro
>   rechaza datos buenos.
>
> Atwater se conserva como **señal para priorizar revisión**, no como criterio de
> rechazo. El balance de masa y la energía a ±2 % son los gates reales.

Estas tres restricciones permiten además **reinsertar la coma decimal de forma
determinista**: si el OCR entrega `800` para carbohidratos, la única lectura que
satisface el balance de masa es `80,0`. No se adivina — se resuelve.

### 8.4 Pipeline

```
PDF -> render 300dpi -> Tesseract por página
   -> parseo de filas (código [A-Z]\d{3} + nombre + N columnas numéricas)
   -> solucionador de coma decimal restringido por rangos plausibles por nutriente
   -> gate de validación (los 3 invariantes)
        · pasa los 3  -> aceptado
        · falla alguno -> escala a revisión por visión sobre el recorte de esa fila
        · sigue fallando -> needs_review = true, NO se siembra
   -> data/tcac_2018.json  (versionado en el repo)
   -> seeder -> food_products
```

La TCAC se publica en varios bloques de tabla que comparten el mismo `Código`
por alimento: análisis proximal, luego minerales, luego vitaminas. El ETL debe
unir los bloques por código, no asumir una sola tabla.

Filas sembradas en `food_products` con: `source='tcac'`, `country_code='CO'`,
`barcode=NULL`, `owner_user_id=NULL`, `basis='per_100g'`, `status='active'`.

### 8.5 Métrica de aceptación de la fase

- **El 100 % de las filas sembradas pasa los tres invariantes.** Lo que no se
  puede validar **no se siembra**. Es preferible entregar 600 alimentos
  verificados que 773 con errores silenciosos: un dato nutricional equivocado no
  se nota en la UI y contamina la dieta del usuario.
- Cobertura mínima aceptable: **≥ 500 alimentos** verificados. Por debajo de eso
  la fase no aporta y hay que replantear el método.
- `data/tcac_2018.json` incluye por fila: `confidence` y `source_page`, para
  poder auditar después.
- Test que vuelve a correr los tres invariantes sobre el JSON sembrado.

### 8.6 Atribución y licencia

El PDF no declara una licencia explícita y trae bandera de restricción de copia.
El ICBF es entidad pública colombiana y la TCAC es información de interés
público. Aun así, **la app debe atribuir la fuente de forma visible** en los
alimentos de origen TCAC: «Fuente: Tabla de Composición de Alimentos Colombianos
(TCAC) 2018 — ICBF». Sin atribución no se publica.
