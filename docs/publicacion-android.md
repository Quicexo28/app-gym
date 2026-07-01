# Publicación en Google Play — Alzo

Estado: el proyecto Android está completo y compila. Lo único que falta para publicar
son los pasos externos (consolas de Google) que requieren cuentas y credenciales.

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

## ⚠️ Respaldo del keystore (crítico)

`~/.android-keys/coachai-release.keystore` + `android/keystore.properties` (contiene
las contraseñas). Si se pierden, no se pueden publicar más actualizaciones de la app.
Guardar copia en un gestor de contraseñas o almacenamiento cifrado. **Nunca commitear.**

Huellas del certificado (necesarias en Google Cloud Console):

| Keystore | SHA-1 |
|----------|-------|
| Release (`~/.android-keys/coachai-release.keystore`) | `A3:35:B4:5E:EB:BF:BB:0E:74:7C:E6:4E:BC:CC:31:12:29:E5:49:4F` |
| Debug (`~/.config/.android/debug.keystore`) | `94:D9:08:2E:32:89:4E:24:A8:61:E8:8E:12:62:0A:55:3E:68:5C:27` |

Nota: si usas Play App Signing (recomendado, default), Google re-firma el AAB con su
propia clave. Después de la primera subida, copia el SHA-1 de "App signing key
certificate" (Play Console → Setup → App signing) y regístralo también en Google Cloud
(paso 2), o el login con Google fallará en la app publicada.

## Pasos externos pendientes

### 1. Backend público con HTTPS

La app móvil necesita el API accesible por internet:

- Desplegar el stack (`docker-compose.prod.yml`) en un VPS/servicio (Fly.io, Railway,
  Hetzner...) con dominio y TLS.
- Configurar CORS del backend para aceptar origen `https://localhost` (origen del
  webview de Capacitor).
- Crear `frontend/.env.mobile` desde `frontend/.env.mobile.example` con
  `VITE_API_BASE_URL=https://tu-dominio`.

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
2. Crear app → completar ficha (nombre, descripción, capturas, icono 512px — usar
   `assets/icon.png` reescalado).
3. **Política de privacidad**: URL pública obligatoria (la app maneja datos de salud/
   fitness y cuenta de Google). Declarar en Data Safety.
4. Subir AAB: `npm run android:aab` →
   `android/app/build/outputs/bundle/release/app-release.aab`.
5. Cuentas personales nuevas: Google exige **prueba cerrada con 12 testers durante 14
   días** antes de poder pasar a producción.

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
- Android SDK: `~/Android/Sdk` (cmdline-tools + platform 35 + build-tools 35).
- `android/local.properties` ya apunta al SDK (no se commitea).
