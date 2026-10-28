# Publicación en App Store — Alzo

Estado: el proyecto iOS existe (`ios/`, Capacitor 8) y el CI compila un `.ipa` **sin
firmar** para pruebas con xtool. Para publicar en App Store hace falta un build firmado
con una cuenta de pago; eso y los pasos de consola son externos al repo.

Textos de la ficha: [ficha-tiendas.md](ficha-tiendas.md). Versión Android:
[publicacion-android.md](publicacion-android.md).

## Qué ya está hecho (en el repo)

| Elemento | Dónde | Valor |
|----------|-------|-------|
| Bundle ID | `ios/App/App.xcodeproj/project.pbxproj` | `com.santiagoquiceno.alzo` |
| Versión / build | ídem | `MARKETING_VERSION 1.0` / `CURRENT_PROJECT_VERSION 1` |
| Mínimo iOS | ídem | 15.5 |
| Dispositivos | ídem | `TARGETED_DEVICE_FAMILY = 1` (solo iPhone) |
| Orientación iPhone | `ios/App/App/Info.plist` | solo vertical |
| Cifrado | `Info.plist` | `ITSAppUsesNonExemptEncryption = false` (sin pregunta de export compliance) |
| Permisos | `Info.plist` | cámara, micrófono, fotos (lectura y guardado) con texto de uso |
| Manifiesto de privacidad | `ios/App/App/PrivacyInfo.xcprivacy` | sin tracking; tipos recogidos coherentes con la tabla de abajo; `UserDefaults` con razón `CA92.1` |
| Sign in with Apple | `ios/App/App/App.entitlements` | `com.apple.developer.applesignin` |
| Login Apple en backend | `src/app/api/v1/endpoints/auth.py` | `POST /api/v1/auth/apple`; revoca el token al borrar la cuenta si hay claves |
| Páginas legales | `frontend/src/pages/legal/*` | `/legal/privacidad`, `/legal/terminos`, `/legal/eliminar-cuenta` |
| Borrado de cuenta in-app | `frontend/src/pages/Preferences.tsx` | Perfil → Ajustes → Zona peligrosa → Eliminar mi cuenta |
| Sin pagos en nativo | `frontend/src/pages/CoachInvite.tsx` | Stripe oculto en app nativa |
| CORS | `src/app/core/config.py` | ya incluye `capacitor://localhost` y `https://localhost` |

Login en iOS: correo + contraseña, Google (SDK nativo) y Sign in with Apple, con la
misma prominencia (`frontend/src/pages/Login.tsx`).

## 0. Requisitos de cuenta y herramientas

| Qué | Detalle |
|-----|---------|
| Apple Developer Program | USD 99/año, https://developer.apple.com/programs/. Necesario para App Store, TestFlight y Sign in with Apple. La cuenta gratuita no sirve. |
| Titular | Cuenta individual (tu nombre sale como vendedor) u organización (requiere D-U-N-S). El nombre del vendedor es público. |
| Mac o runner macOS | El archivo firmado se genera con Xcode: runner `macos-26` de GitHub Actions (ya usado en `.github/workflows/ios.yml`) o un Mac. |
| Backend público con HTTPS | Mismo requisito que Android. Sin él, Review no puede usar la app. Ver `docs/publicacion-android.md` paso 1. |

Sign in with Apple **no funciona** en builds instaladas con xtool/cuenta gratuita
(el entitlement requiere perfil de pago). Pruébalo solo con TestFlight.

## 1. Apple Developer (portal de cuenta)

### 1.1 App ID

Certificates, Identifiers & Profiles → Identifiers → **+** → App IDs → App:

- Bundle ID **Explicit**: `com.santiagoquiceno.alzo`.
- Capabilities: marca **Sign in with Apple** (Enable as primary App ID).

### 1.2 Key para Sign in with Apple (revocar tokens al borrar cuenta)

Keys → **+** → marca **Sign in with Apple** → Configure → Primary App ID = el de arriba →
descarga el `.p8` (solo se puede bajar una vez). Anota el **Key ID** y el **Team ID**
(Membership details).

Variables del backend (`.env.prod.example`):

| Variable | Valor |
|----------|-------|
| `APPLE_CLIENT_IDS` | `["com.santiagoquiceno.alzo"]` (JSON; audiencias válidas del identity token) |
| `APPLE_TEAM_ID` | Team ID |
| `APPLE_KEY_ID` | Key ID del `.p8` |
| `APPLE_PRIVATE_KEY` | contenido del `.p8` en una línea, saltos de línea como `\n` |

Sin `APPLE_TEAM_ID`/`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY` el login funciona, pero al borrar
la cuenta no se revoca el token de Apple. Apple lo exige en la práctica (5.1.1(v)):
configúralo antes de enviar.

Reinicia el backend tras cambiar el `.env` y comprueba que `POST /api/v1/auth/apple`
no responda `503 Apple login is not configured`.

## 2. Google Cloud (login con Google en iOS)

En el mismo proyecto del client Web: **OAuth client ID → iOS**, Bundle ID
`com.santiagoquiceno.alzo`. Resultado: un client ID `yyyy.apps.googleusercontent.com`.

| Dónde | Variable | Valor |
|-------|----------|-------|
| Backend | `GOOGLE_IOS_CLIENT_ID` | client ID iOS |
| `frontend/.env.mobile` o variable del repo (CI) | `VITE_GOOGLE_IOS_CLIENT_ID` | client ID iOS |
| Variable del repo (CI) | `GOOGLE_IOS_URL_SCHEME` | client ID iOS **invertido**: `com.googleusercontent.apps.yyyy`. Se inyecta en `CFBundleURLTypes` del `Info.plist`; sin él el login nativo falla. |

`VITE_GOOGLE_CLIENT_ID` sigue siendo el client **Web** (el mismo del backend). Sin
`VITE_GOOGLE_IOS_CLIENT_ID` el botón de Google no aparece en iOS.

Si vas a compilar firmado en CI, pasa también `GOOGLE_IOS_URL_SCHEME=...` a `xcodebuild`
(ver paso 5).

## 3. Textos legales y datos del responsable

Antes de compilar define (`frontend/.env.mobile` o variables del repo/CI):

- `VITE_LEGAL_CONTACT_EMAIL` y `VITE_LEGAL_OWNER_NAME`. Si faltan, las páginas legales
  muestran el aviso "(correo de contacto no configurado)" (`frontend/src/lib/legal.ts`);
  Review lo vería.
- `VITE_API_BASE_URL` con HTTPS.
- `VITE_ENABLE_GUEST_LOGIN=false` (o ausente) en el build de tienda.

Las páginas `/legal/*` deben ser accesibles **sin iniciar sesión** en una URL pública:
sirve el frontend web (nginx del stack de producción) en tu dominio y verifica
`https://tu-dominio/legal/privacidad`, `/legal/terminos`, `/legal/eliminar-cuenta`.

## 4. App Store Connect

https://appstoreconnect.apple.com → Apps → **+** → New App:

| Campo | Valor |
|-------|-------|
| Plataformas | iOS |
| Nombre | `Alzo: entrenamiento y dieta` (ver [ficha-tiendas.md](ficha-tiendas.md)); si está tomado, prueba otra variante |
| Idioma principal | Spanish (Mexico) o Spanish (Spain): App Store Connect no ofrece es-CO; el idioma en el binario es `es` |
| Bundle ID | `com.santiagoquiceno.alzo` (aparece tras registrar el App ID) |
| SKU | libre, p. ej. `alzo-ios-001` (no cambia después) |
| Acceso de usuario | Acceso completo |

### 4.1 Información de la app

| Campo | Valor |
|-------|-------|
| Categoría principal | Salud y forma física |
| Categoría secundaria | Estilo de vida (opcional) |
| URL de política de privacidad | `https://tu-dominio/legal/privacidad` |
| Derechos de contenido | No contiene contenido de terceros |
| Clasificación de edad | Responde el cuestionario de App Store Connect con honestidad. Datos relevantes: sin contenido violento/sexual/apuestas/alcohol, sin chat entre usuarios, sin navegador web abierto, sin compras. Hay datos de salud y la app es para mayores de 18 años (los términos lo exigen). Apple cambió el cuestionario y los niveles de edad en 2025; verifica las preguntas vigentes en la consola, no las hemos podido contrastar aquí. |

### 4.2 Versión 1.0

| Campo | Valor |
|-------|-------|
| Texto promocional, descripción, palabras clave, novedades | [ficha-tiendas.md](ficha-tiendas.md) |
| URL de soporte | Una página pública con tu correo de contacto (puede ser `https://tu-dominio/legal/privacidad` si no tienes otra, aunque una página propia de soporte es mejor) |
| URL de marketing | opcional |
| Copyright | `2026 <tu nombre>` |
| Información de inicio de sesión para Review | ver sección 8 |
| Cifrado / export compliance | Ya resuelto por `ITSAppUsesNonExemptEncryption=false` (solo HTTPS estándar). No se pregunta al subir cada build. |
| Publicidad (IDFA) | No |
| Contenido de terceros | No |

### 4.3 App Privacy (etiquetas de privacidad)

App Store Connect → App Privacy. Responde "Sí, recopilamos datos". Declara por tipo, y
para todos: **vinculado a la identidad: Sí**, **uso para rastreo: No**. Propósito único
para todos: **Funcionalidad de la app** (la política de privacidad no declara analítica,
publicidad ni personalización).

"Recopilar" en Apple = enviar fuera del dispositivo. Lo que se queda local no se declara
(fotos de progreso, audio, imágenes del escáner/OCR).

| Categoría Apple | Tipo | Declarar | De dónde sale |
|-----------------|------|----------|---------------|
| Información de contacto | Dirección de correo | Sí | cuenta, Google, Apple |
| Información de contacto | Número de teléfono | Sí | celular opcional |
| Información de contacto | Nombre | Sí | nombre visible / nombre de Apple |
| Identificadores | ID de usuario | Sí | id de cuenta, `sub` de Google y de Apple |
| Identificadores | ID de dispositivo | No | la app no lo recoge |
| Salud y forma física | Salud | Sí | peso, % de grasa, bienestar (sueño, estrés), medidas |
| Salud y forma física | Forma física | Sí | entrenamientos, series, cargas, planes |
| Contenido del usuario | Fotos o vídeos | Sí | solo fotos de empaques/etiquetas subidas (las de progreso no salen del dispositivo) |
| Contenido del usuario | Otro contenido del usuario | Sí | notas, comentarios, texto transcrito de voz, comidas y alimentos |
| Contenido del usuario | Audio | No | el audio se procesa y descarta en el dispositivo |
| Otros datos | Otros tipos de datos | Sí | fecha de nacimiento, género, estatura, biografía, dieta |
| Ubicación, contactos, compras, historial de navegación/búsqueda | — | No | la app no los recoge (las compras de coach solo existen en web) |
| Datos de uso / Diagnóstico | — | No | no hay analítica ni crash reporting de terceros; los logs del servidor (IP, ruta, fecha) son solo seguridad y diagnóstico |

El `PrivacyInfo.xcprivacy` del repo ya declara los mismos tipos (correo, teléfono,
nombre, ID de usuario, salud, forma física, fotos/vídeos, otro contenido, otros datos),
todos vinculados, sin rastreo, con propósito Funcionalidad de la app. Mantén ambos
iguales: Apple compara el manifiesto con las etiquetas.

Decisión pendiente tuya: si quieres ser conservador con los logs del servidor (la IP),
añade **Datos de diagnóstico → Otros datos de diagnóstico** (vinculado: No, propósito:
Funcionalidad de la app). La guía de Apple permite no declarar datos que solo se usan
para seguridad del servicio, pero declararlos no causa rechazo.

### 4.4 Capturas

Fuente: [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
(consultada el 2026-10-28).

- Obligatorio: al menos un set de iPhone, grupo **Dynamic Island, medio** (≈6.1"):
  **1179×2556** o **1206×2622** px (vertical).
- Si no subes un grupo, Apple usa el siguiente de respaldo; para iPhone grande (≈6.9"
  Pro Max: 1320×2868, 1290×2796 o 1260×2736) y Face ID grande (≈6.5": 1284×2778 o
  1242×2688) puedes subirlos aparte para mejor calidad, pero no son obligatorios si
  la interfaz es consistente.
- 1 a 10 capturas por tamaño; JPEG o PNG sin canal alfa ni transparencia.
- La app es solo iPhone (`TARGETED_DEVICE_FAMILY = 1`): no hacen falta capturas de iPad.

Recomendación: 5 a 6 capturas en 1290×2796 (Pro Max, cubre el grupo grande) y 1206×2622
(requerido), mostrando: sesión de entrenamiento, registro por voz, dieta con escáner,
medidas, pantalla de predicción/señales y rutinas. Usa el simulador de Xcode o un
iPhone real con una cuenta demo con datos (sección 8); sin barra con datos personales.

## 5. Compilar firmado y subir

El workflow actual (`.github/workflows/ios.yml`) hace `CODE_SIGNING_ALLOWED=NO` y solo
sirve para xtool. Para App Store hay que **archivar firmado y exportar** con perfil de
distribución. Elige una ruta:

### Opción A (recomendada la primera vez): Mac con Xcode

1. En el Mac: `npm ci && npm ci --prefix frontend`, `frontend/.env.mobile` completo y
   `npm run build:mobile:ios`.
2. `open ios/App/App.xcworkspace` → target App → Signing & Capabilities: Team = tu
   cuenta de pago, "Automatically manage signing" (el proyecto ya usa `CODE_SIGN_STYLE
   = Automatic`). Confirma la capability Sign in with Apple.
3. Define `GOOGLE_IOS_URL_SCHEME` en Build Settings → User-Defined (Release) con el
   esquema invertido. Sin él, `CFBundleURLSchemes` queda vacío.
4. Destino "Any iOS Device (arm64)" → Product → Archive → Distribute App → App Store
   Connect → Upload.

### Opción B: CI en macOS con firma

Nuevo workflow (no existe todavía; el actual debe seguir siendo el de xtool). Secrets
necesarios en GitHub:

| Secret | Contenido |
|--------|-----------|
| Certificado de distribución `.p12` (base64) y su contraseña | Apple Distribution, creado en el portal |
| Perfil de aprovisionamiento App Store (base64) | para `com.santiagoquiceno.alzo` con Sign in with Apple |
| API key de App Store Connect | Users and Access → Integrations → App Store Connect API: Key ID, Issuer ID y `.p8` |

Pasos del job: importar el certificado a un keychain temporal, instalar el perfil,
`npm run build:mobile:ios`, `xcodebuild archive` (con `GOOGLE_IOS_URL_SCHEME=...` y
firma manual) y `xcodebuild -exportArchive` con un `ExportOptions.plist`
(`method = app-store-connect`), y subir.

### Herramienta de subida (verifica en tu versión de Xcode)

| Herramienta | Estado | Nota |
|-------------|--------|------|
| Xcode Organizer / Transporter (app de Mac) | Soportadas por Apple | Lo más simple en un Mac. |
| `xcrun altool --upload-app` | Aparece en la [página de Apple](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/) como opción vigente, pero la guía de altool la marca como obsoleta a favor de `--upload-package`; hay reportes de fallos en Xcode 26 | Comprueba `xcrun altool --help` en el runner antes de depender de ella. |
| `xcodebuild -exportArchive` con `destination = upload` en el ExportOptions y `-authenticationKeyID/-authenticationKeyIssuerID/-authenticationKeyPath` | Sin confirmar con la Xcode actual | Prueba en tu runner. |
| App Store Connect API (endpoint `buildUploads`) | Soportada | Más trabajo; solo si montas tu propio cliente. |
| fastlane `pilot` / `upload_to_testflight` con API key | Herramienta de terceros, muy usada en CI | Añade una dependencia (Ruby); no está en el repo. |

`notarytool` no aplica: es para notarizar apps de macOS, no para iOS.

Para este proyecto: **primera subida con Opción A (Organizer)**; automatiza con la
Opción B solo si vas a publicar seguido. No se pudo comprobar en el entorno actual
(Linux) ninguna de estas rutas; el CI actual no las ejerce.

### Cada release siguiente

1. Sube `CURRENT_PROJECT_VERSION` (+1, único por build) y, si cambia la versión pública,
   `MARKETING_VERSION` en `ios/App/App.xcodeproj/project.pbxproj` (o desde Xcode).
2. Compila, sube, espera el procesamiento en App Store Connect (minutos) y elige el
   build en la versión.

## 6. TestFlight

1. Tras procesar el build: TestFlight → el build aparece con aviso de cumplimiento
   (no debería preguntar cifrado).
2. **Pruebas internas**: hasta 100 miembros de tu equipo de App Store Connect; sin
   revisión. Úsalas para validar Sign in with Apple y Google en dispositivo real.
3. **Pruebas externas**: requieren una revisión corta de Beta App Review (necesita el
   mismo usuario demo de la sección 8).

## 7. Backend para Review

Antes de enviar: backend en HTTPS estable, migraciones aplicadas (la migración
`migrations/versions/66b5373e5a18_add_apple_sign_in_fields.py` añade los campos de
Apple), variables de la sección 1 y 2 cargadas, y el backend arriba durante toda la
revisión (puede tardar días). Comprueba `/health`.

## 8. Notas para App Review y cuenta demo

Review exige acceso completo (guideline 2.1). Aunque ofrezcas Apple/Google, da una
cuenta de correo y contraseña.

**Qué hacer (tú):**

1. Crea en producción un usuario demo (p. ej. `review@tu-dominio`, contraseña fuerte)
   con datos de ejemplo: 3-4 rutinas, ~10 sesiones de varias semanas, medidas de
   peso/grasa, 1 semana de dieta y un análisis ejecutado en "Predicción", para que
   las señales y proyecciones no salgan vacías.
2. No lo borres ni cambies la contraseña durante la revisión.
3. Pega usuario y contraseña en App Review Information → Sign-in required.

**Texto para el campo "Notes" (copiar y completar):**

```
Alzo es un registro de entrenamiento, dieta y medidas corporales que muestra señales y proyecciones estadísticas sobre los datos del propio usuario.

Cuenta de prueba (correo y contraseña): <usuario> / <contraseña>. Tiene datos de ejemplo cargados.

Inicio de sesión: correo y contraseña, Google y Sign in with Apple (guideline 4.8). Sign in with Apple solo devuelve el correo y el nombre que el usuario decide compartir.

Eliminación de cuenta (5.1.1(v)): Perfil > Ajustes > Zona peligrosa > Eliminar mi cuenta (se escribe ELIMINAR CUENTA para confirmar). Se borra en el momento y se revoca el token de Apple.

Sin compras: la app no ofrece compras dentro de la app ni suscripciones, y no enlaza a pagos externos. El pago del plan de coach existe solo en la versión web y está oculto en la app iOS.

Información de salud: las proyecciones y señales son estimaciones informativas con incertidumbre explícita. La app no diagnostica, no trata y no da consejo médico (el aviso aparece en la ficha y en los términos de uso). Es para mayores de 18 años.

Permisos: cámara (escanear códigos de barras y fotografiar etiquetas nutricionales), micrófono (registrar series por voz; el reconocimiento ocurre en el dispositivo y el audio no se envía) y fotos (elegir una imagen de etiqueta). Todos opcionales.

Política de privacidad: https://tu-dominio/legal/privacidad. No hay anuncios ni rastreo.
```

El aviso médico existe en `frontend/src/pages/legal/Terms.tsx` y en
[ficha-tiendas.md](ficha-tiendas.md). Fuera de las páginas legales no encontré ningún
aviso dentro de las pantallas de Predicción; considera añadir uno (cambio de código, no
hecho aquí).

## 9. Checklist de guidelines

| Guideline | Qué pide | Estado | Evidencia / pendiente |
|-----------|----------|--------|-----------------------|
| 2.1 App completa | Sin errores, cuenta demo, backend arriba | ⚠️ | Falta cuenta demo y backend público con HTTPS (pasos tuyos). |
| 2.1 / 2.3 Metadatos | Textos y capturas fieles | ⚠️ | Falta subir capturas; los textos están en `ficha-tiendas.md`. |
| 3.1.1 Pagos in-app | Contenido digital se compra con IAP | ✅ | Stripe oculto en nativo (`CoachInvite.tsx`); no hay compras en iOS. Revisa que ningún texto de la app iOS invite a pagar fuera. |
| 4.8 Login equivalente | Si hay Google, ofrecer opción con privacidad (Apple) | ✅ | Sign in with Apple en iOS, misma prominencia que Google (`Login.tsx`). |
| 5.1.1(i) Política de privacidad | URL pública y en la app | ⚠️ | Páginas listas; falta desplegarlas en tu dominio y fijar `VITE_LEGAL_*`. |
| 5.1.1(v) Borrado de cuenta | Borrado iniciado desde la app + revocar Apple | ⚠️ | Borrado in-app ✅. Revocación necesita `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` en el backend de producción. |
| 5.1.1 Permisos | Textos de uso claros | ✅ | `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibrary*` en `Info.plist`. Están escritos sin tildes ("camara", "microfono"); funciona, pero se ven mal en español. |
| 5.1.2 Uso y compartición de datos | Etiquetas coherentes con la política y el manifiesto | ⚠️ | Tabla de 4.3 lista; falta rellenarla en App Store Connect. |
| 1.4.1 Información médica | Datos médicos precisos, aviso de que no sustituye a un profesional | ⚠️ | Aviso en términos y en la ficha ✅; no hay aviso visible en las pantallas de señales/proyecciones. |
| Manifiesto de privacidad | `PrivacyInfo.xcprivacy` presente | ✅ | En `ios/App/App/`. Si añades SDKs de terceros, revisa que traigan su propio manifiesto. |
| Edad | 18+ coherente en todos lados | ✅ | Política y términos lo declaran; la clasificación de edad debe responderse acorde. |
