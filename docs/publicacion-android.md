# Publicación en Google Play — Alzo

Estado: el proyecto Android está completo y compila. Lo único que falta para publicar
son los pasos externos (consolas de Google) que requieren cuentas y credenciales.

Textos de la ficha: [ficha-tiendas.md](ficha-tiendas.md). Versión iOS:
[publicacion-ios.md](publicacion-ios.md).

## Qué ya está hecho (en el repo)

- Proyecto nativo Capacitor 8 en `android/` (appId `com.santiagoquiceno.alzo`).
- Iconos y splash nativos generados desde `assets/` con `@capacitor/assets`.
- Login con Google compatible con app nativa (`@capgo/capacitor-social-login`,
  Credential Manager). En web sigue funcionando Google Identity Services.
- Firma release configurada: `android/keystore.properties` (fuera de git) apunta a
  `~/.android-keys/coachai-release.keystore`.
- Scripts npm:
  - `npm run build:mobile` — build web con `--mode mobile` (lee `frontend/.env.mobile`) + `cap sync`.
  - `npm run android:apk` — APK debug para probar en dispositivo.
  - `npm run android:aab` — AAB release firmado, listo para subir a Play.
- Manifest (`android/app/src/main/AndroidManifest.xml`): permisos `INTERNET`, `CAMERA`,
  `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`; `AD_ID` y `ACCESS_ADSERVICES_*` se eliminan
  con `tools:node="remove"`. El SDK de Facebook no se empaqueta
  (`plugins.SocialLogin.providers.facebook: false` en `capacitor.config.ts`).
- `targetSdk 36`, `minSdk 24`, `versionCode 1` / `versionName "1.0"`
  (`android/variables.gradle`, `android/app/build.gradle`).
- Botón atrás de Android con `@capacitor/app` (`frontend/src/lib/nativeBackButton.ts`).
- Páginas legales públicas y borrado de cuenta (ver "Cumplimiento de políticas").
- En nativo están ocultos los pagos de Stripe del plan coach (`CoachInvite.tsx`) y la
  tarjeta "Pasos"; no hay service worker en el build mobile.

## ⚠️ Respaldo del keystore (crítico)

`~/.android-keys/coachai-release.keystore` + `android/keystore.properties` (contiene
las contraseñas). Si se pierden, no se pueden publicar más actualizaciones de la app.
Guardar copia en un gestor de contraseñas o almacenamiento cifrado. **Nunca commitear.**

Huellas del certificado (necesarias en Google Cloud Console):

| Keystore | SHA-1 |
|----------|-------|
| Release (`~/.android-keys/coachai-release.keystore`) | `A3:35:B4:5E:EB:BF:BB:0E:74:7C:E6:4E:BC:CC:31:12:29:E5:49:4F` |
| Debug (`~/.config/.android/debug.keystore`) | `94:D9:08:2E:32:89:4E:24:A8:61:E8:8E:12:62:0A:55:3E:68:5C:27` |

Nota: el login con Google en Android usa Credential Manager con el client **Web**
como `serverClientId`; el client Android solo debe existir con package y SHA-1 correctos.

Nota: si usas Play App Signing (recomendado, default), Google re-firma el AAB con su
propia clave. Después de la primera subida, copia el SHA-1 de "App signing key
certificate" (Play Console → Setup → App signing) y regístralo también en Google Cloud
(paso 2), o el login con Google fallará en la app publicada.

## Pasos externos pendientes

### 1. Backend público con HTTPS

La app móvil necesita el API accesible por internet:

- Desplegar el stack (`docker-compose.prod.yml`) en un VPS/servicio (Fly.io, Railway,
  Hetzner...) con dominio y TLS.
- CORS: `https://localhost` (webview Android) y `capacitor://localhost` (iOS) ya están
  en `cors_origins` de `src/app/core/config.py`; no hace falta configurarlos.
- Crear `frontend/.env.mobile` desde `frontend/.env.mobile.example` con
  `VITE_API_BASE_URL=https://tu-dominio`, `VITE_LEGAL_CONTACT_EMAIL`,
  `VITE_LEGAL_OWNER_NAME` y `VITE_ENABLE_GUEST_LOGIN=false`. Sin los `VITE_LEGAL_*`
  las páginas legales muestran "(correo de contacto no configurado)".
- Servir el frontend web en el mismo dominio: las páginas `/legal/*` deben abrir sin
  iniciar sesión (Play las revisa).

### 2. Google Cloud Console (login con Google)

En el mismo proyecto donde vive el OAuth client web actual:

1. Crear credencial **OAuth client ID → Android**:
   - Package name: `com.santiagoquiceno.alzo`
   - SHA-1: registrar **ambas** huellas de la tabla (release y debug; se pueden crear
     dos clients Android o añadir la segunda luego).
2. En `frontend/.env.mobile`, `VITE_GOOGLE_CLIENT_ID` = el client ID **Web** (el mismo
   del backend). El client Android no se referencia en código; solo debe existir.

### 3. Play Console

1. Cuenta de desarrollador: https://play.google.com/console — USD $25 único, requiere
   verificación de identidad.
2. Crear app → idioma por defecto `es-419` o `es-CO` si aparece; nombre, descripciones y
   categoría desde [ficha-tiendas.md](ficha-tiendas.md). Icono 512 px (reescalar
   `assets/icon.png`) y gráfico de funciones 1024x500. Capturas de teléfono: mínimo 2
   (recomendado 4-8).
3. Subir AAB: `npm run android:aab` →
   `android/app/build/outputs/bundle/release/app-release.aab`.
4. **Prueba cerrada antes de producción** (ver "Prueba cerrada").
5. Completar **todas** las declaraciones de "Contenido de la app" (sección siguiente).

## Cumplimiento de políticas (Play Console → Política y programas → Contenido de la app)

Las URLs usan el dominio donde sirvas el frontend.

| Declaración | Qué poner |
|-------------|-----------|
| Política de privacidad | `https://tu-dominio/legal/privacidad` |
| Acceso a la app | Hay inicio de sesión: da un usuario demo (correo y contraseña) con datos de ejemplo. Mismo usuario que en [publicacion-ios.md](publicacion-ios.md) sección 8. |
| Anuncios | **No** contiene anuncios |
| Público objetivo | **18 años o más** únicamente (política y términos lo exigen). Así no entra en el programa "Diseñado para familias". |
| ID de publicidad | **No** usa ID de publicidad. Coherente con el manifest (`AD_ID` eliminado, sin SDK de Facebook). Verifica en el AAB subido que Play no marque el permiso. |
| Clasificación de contenido (IARC) | Categoría: aplicación de **utilidad/referencia o salud**, no juego. Responde "No" a violencia, sexo, lenguaje fuerte, sustancias controladas y apuestas; "No" a compartir ubicación; **"Sí" a que los usuarios interactúan** solo si Play lo pregunta por las notas/comentarios entre coach y atleta (no hay contenido público generado por usuarios, salvo el catálogo compartido de alimentos). Resultado esperado: apto para todos o 3+; el 18+ lo fija el público objetivo, no IARC. |
| Apps de salud | Ver "Declaración de apps de salud". |
| Eliminación de cuenta | Ver "Eliminación de cuenta". |
| Apps de noticias, gobierno, finanzas, COVID-19, funciones de seguridad | No aplica |

### Declaración de apps de salud

Se llama **Health apps** (en español, "Apps de salud") y está en Play Console → Política
y programas → Contenido de la app. Es obligatoria para toda app publicada, incluso si
no tiene funciones de salud (fuente:
[Provide information for the Health apps declaration form](https://support.google.com/googleplay/android-developer/answer/14738291)).
Para Alzo:

- Declara funciones en la categoría **Salud y forma física**: *Actividad y forma física*
  (registro de entrenamiento) y *Nutrición y control de peso* (dieta, peso, % de grasa).
- **No** declares la categoría *Medicina*: la app no es un dispositivo médico ni
  diagnostica (los términos lo dicen en `frontend/src/pages/legal/Terms.tsx`).
- **No** usa Health Connect (no hay permisos `android.permission.health.*` en el
  manifest), así que no hay tipos de datos de Health Connect que justificar.
- La segunda página del formulario puede pedir información adicional según las
  funciones marcadas; guarda borrador si dudas. Lo exacto de esas preguntas no se pudo
  verificar sin acceso a la consola.

### Data Safety

Play Console → Política y programas → Contenido de la app → Seguridad de los datos.
Definiciones de Google ([fuente](https://support.google.com/googleplay/android-developer/answer/10787469)):
**recopilado** = sale del dispositivo (incluido por SDKs); **compartido** = se transfiere
a un tercero. Un proveedor que procesa solo por tu cuenta no cuenta como "compartir";
lo que se procesa solo en el dispositivo no se declara.

Preguntas generales:

| Pregunta | Respuesta |
|----------|-----------|
| ¿Recopila o comparte datos de usuario? | Sí |
| ¿Todos los datos se cifran en tránsito? | **Sí**, siempre que el backend esté detrás de HTTPS (`allowMixedContent: false` en `capacitor.config.ts`). Confirma el despliegue con TLS antes de responder. |
| ¿Ofrece forma de solicitar que se eliminen los datos? | Sí (in-app y por URL; ver "Eliminación de cuenta") |
| URL de eliminación de cuenta | `https://tu-dominio/legal/eliminar-cuenta` |

Tabla por tipo de dato (inventario de `PrivacyPolicy.tsx`). Todos: **no compartido** con
terceros, propósito **Funcionalidad de la app** (más "Administración de la cuenta" para
los de la cuenta), no para publicidad ni analítica, **se puede eliminar** (borrando la
cuenta).

| Categoría Play | Tipo | Recopilado | Compartido | Opcional | Notas |
|----------------|------|-----------|-----------|----------|-------|
| Información personal | Dirección de correo | Sí | No | Obligatorio | cuenta, Google, Apple |
| Información personal | Nombre | Sí | No | Opcional | nombre visible |
| Información personal | Nº de teléfono | Sí | No | Opcional | celular |
| Información personal | ID de usuario | Sí | No | Obligatorio | id de cuenta, `sub` de Google/Apple |
| Información personal | Otra info (fecha de nacimiento, género, estatura, biografía) | Sí | No | Opcional | perfil |
| Salud y forma física | Información de salud (peso, % grasa, medidas, bienestar) | Sí | No | Opcional | |
| Salud y forma física | Información de forma física (entrenamientos, cargas) | Sí | No | Opcional | núcleo de la app |
| Salud y forma física | Dieta (calorías, macros) | Sí | No | Opcional | tipo "Información de salud" en Play |
| Fotos y vídeos | Fotos | Sí | No | Opcional | solo fotos de empaques/etiquetas subidas; las de progreso no salen del dispositivo |
| Actividad en la app | Otro contenido generado por el usuario (notas, comentarios, texto transcrito de voz) | Sí | No | Opcional | |
| Audio | Grabaciones de voz | **No recopilado** | — | — | el audio se procesa en el dispositivo y no se envía |
| Ubicación, contactos, mensajes, calendario, archivos | — | No | — | — | |
| Información financiera | — | No | — | — | las compras de coach ocurren solo en web (Stripe); la app Android no las ofrece |
| Info y rendimiento de la app / ID de dispositivo | — | Ver abajo | — | — | |

Puntos que debes decidir con cuidado:

- **Compartido con el coach**: el atleta que se une a un coach le da acceso a sus datos
  a petición propia. Es una acción iniciada por el usuario y un destinatario que ya es
  usuario de la app; Google la excluye de "compartir" si el usuario inicia la
  transferencia, pero decláralo en la política (ya está en `PrivacyPolicy.tsx`).
- **Catálogo compartido de alimentos**: un alimento con código de barras queda visible
  para todos los usuarios, sin mostrar quién lo aportó. Tampoco se declara como
  compartición con terceros.
- **Google / Apple / Open Food Facts**: Google y Apple validan el login; Open Food Facts
  recibe solo el número de código de barras desde el servidor, sin datos del usuario.
  No son compartición de datos personales del usuario.
- **ML Kit** (`@capacitor-mlkit/barcode-scanning` y `text-recognition`): las imágenes se
  procesan en el dispositivo, pero Google documenta que ML Kit recopila información de
  dispositivo (modelo, SO), de la app (paquete, versión), identificadores por
  instalación y métricas de rendimiento, "para diagnóstico y analítica de uso" (fuente:
  [ML Kit data disclosure](https://developers.google.com/ml-kit/android-data-disclosure)).
  Google no lo trata como compartir con terceros, pero tú declaras lo que haga tu app y
  sus SDKs. Para ser coherente con Google, marca además **Info y rendimiento de la app →
  Diagnóstico** y **ID de dispositivo u otros** como recopilados, no compartidos,
  propósito *Analítica*/*Funcionalidad*, y obligatorios (no se puede desactivar).
  Si el AAB usa los modelos de ML Kit sin empaquetar (por Google Play services), la
  recopilación la hace Play services; confírmalo en el informe de SDK de Play Console
  tras la primera subida.
- Cada vez que cambies de SDK, vuelve a revisar el formulario.

### Eliminación de cuenta

- Dentro de la app: Perfil → Ajustes → Zona peligrosa → Eliminar mi cuenta (escribir
  `ELIMINAR CUENTA`).
- URL web para Play: `https://tu-dominio/legal/eliminar-cuenta`
  (`frontend/src/pages/legal/DeleteAccount.tsx`), que explica el proceso, qué se borra y
  qué no, y el correo de contacto para quien no tenga la app. Pégala en Seguridad de los
  datos → "Eliminación de cuenta".
- Las fotos de progreso viven solo en el dispositivo y no se borran con la cuenta (la
  página lo dice).

### Justificación de permisos

Play puede pedirla si el manifest incluye permisos sensibles. Texto base:

| Permiso | Justificación |
|---------|---------------|
| `CAMERA` | Escanear códigos de barras y fotografiar etiquetas nutricionales y fotos de progreso. Opcional: la app funciona sin ella (`uses-feature` camera `required=false`). |
| `RECORD_AUDIO` | Registrar series de entrenamiento por voz. El audio se transcribe en el dispositivo con un modelo incluido en la app y no se guarda ni envía. Solo mientras el usuario activa la captura por voz. |
| `MODIFY_AUDIO_SETTINGS` | Ajuste de audio asociado a la captura por voz. |
| `INTERNET` | Comunicación con el servidor (cuenta, sincronización). |

No se piden permisos de ubicación, contactos, almacenamiento amplio ni notificaciones.

### Prueba cerrada (12 testers / 14 días)

Vigente para cuentas personales creadas después del 13-nov-2023: mínimo **12 testers**
con opt-in continuo durante los **14 días** previos a solicitar acceso a producción
(fuente: [ayuda de Play Console](https://support.google.com/googleplay/android-developer/answer/14151465),
consultada el 2026-10-28). Los testers que salen y vuelven reinician la cuenta de días.
Una cuenta de organización no tiene este requisito. Cuando termines, solicita acceso a
producción en la consola y responde el cuestionario.

Para la prueba cerrada también necesitas ficha, política de privacidad, Data Safety y
las declaraciones de arriba completas.

### 4. Cada release siguiente

1. Subir `versionCode` (+1) y `versionName` en `android/app/build.gradle`.
2. `npm run android:aab` y subir el nuevo AAB.

## Probar en dispositivo local (sin nada externo)

```bash
npm run android:apk
~/Android/Sdk/platform-tools/adb install android/app/build/outputs/apk/debug/app-debug.apk
```

Sin `frontend/.env.mobile`, la app funciona 100% offline (rutinas locales, voz Vosk);
login y sync quedan inactivos hasta tener backend público.

## Entorno de compilación (esta máquina)

- JDK 21: `/usr/lib/jvm/java-21-openjdk` (pacman).
- Android SDK: `~/Android/Sdk` (cmdline-tools + platforms 35 y 36; el proyecto compila
  con `compileSdkVersion = 36`).
- `android/local.properties` ya apunta al SDK (no se commitea).
