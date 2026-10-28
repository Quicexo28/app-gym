# Ficha de tiendas — Alzo (es-CO)

Textos listos para pegar en App Store Connect y Play Console. La cuenta de caracteres
está medida con `python3 -c 'print(len("..."))'` (cuenta emojis y saltos de línea).
Si cambias un texto, vuelve a contar.

Criterio: coherente con el README ("la app no decide: muestra señales y proyecciones con
incertidumbre"). Sin promesas de resultados ni médicas. Solo funciones visibles en nativo:
no se mencionan pagos ni "Pasos" (ocultos en la app nativa).

## Resumen

| Campo | Tienda | Límite | Texto | Caracteres |
|-------|--------|--------|-------|-----------|
| Nombre | Ambas | 30 | `Alzo: entrenamiento y dieta` | 27 |
| Subtítulo | iOS | 30 | `Señales y proyecciones` | 22 |
| Descripción corta | Play | 80 | `Registra entrenamiento, dieta y medidas; ve señales y proyecciones sin promesas.` | 80 |
| Palabras clave | iOS | 100 | ver abajo | 98 |
| Texto promocional | iOS | 170 | ver abajo | 148 |
| Novedades 1.0 | Ambas | 4000 (Play 500) | `Primera versión de Alzo.` | 24 |
| Descripción completa | Ambas | 4000 | ver abajo | 2303 |

## Categoría

| Tienda | Categoría principal | Secundaria (opcional) |
|--------|--------------------|-----------------------|
| App Store | Salud y forma física | Estilo de vida |
| Google Play | Aplicación → Salud y bienestar (`Health & Fitness`) | — |

## Palabras clave (iOS, 98 caracteres)

Separadas por comas, sin espacios tras la coma (los espacios cuentan). No repitas el
nombre ni el subtítulo: Apple ya los indexa.

```
gimnasio,rutinas,pesas,series,macros,calorías,código de barras,medidas,progreso,planificador,coach
```

## Texto promocional (iOS, 148 caracteres)

Se puede cambiar sin nueva revisión.

```
Registra tus series incluso por voz y sin conexión, tu dieta con código de barras y tus medidas. Alzo te muestra señales y proyecciones; tú decides.
```

## Descripción completa (2303 caracteres)

Sirve igual para App Store ("Descripción") y Play ("Descripción completa").

```
Alzo es un registro de entrenamiento, dieta y medidas corporales que te muestra señales y proyecciones sobre tus propios datos. La app no decide por ti: te enseña qué dice tu historial, con cuánta incertidumbre y con qué regla, y tú (o tu coach) tienes la última palabra.

ENTRENAMIENTO
• Crea rutinas y ejercicios propios y registra tus sesiones: series, repeticiones, carga y esfuerzo.
• Programa tus semanas y ciclos de entrenamiento en la sección de programación.
• Registra series por voz, sin conexión: el reconocimiento de voz funciona dentro de tu dispositivo y el audio nunca se envía.
• Consulta la evolución de tus cargas por rutina y por ejercicio.

DIETA
• Lleva un diario de comidas con calorías, macronutrientes y micronutrientes.
• Escanea el código de barras de un producto o fotografía su etiqueta nutricional para crear el alimento; la lectura se hace en tu dispositivo.
• Guarda tus comidas y alimentos personales, y define tus objetivos nutricionales.
• Revisa el historial y las tendencias de lo que comes.

MEDIDAS Y PROGRESO
• Registra peso, perímetros y porcentaje de grasa, y mira su evolución en el tiempo.
• Guarda fotos de progreso: se quedan solo en tu dispositivo, no se suben a ningún servidor.

SEÑALES Y PROYECCIONES
• Analiza tu historial para ver próximas series, marcas posibles y avisos, cada uno con la regla que lo originó.
• Las proyecciones son estimaciones con incertidumbre, no promesas. Alzo guarda lo que proyectó y lo compara después con lo que pasó, para que veas qué tan acertado fue.

MODO COACH
• Si entrenas con un coach, puedes unirte con su código de invitación. Él podrá ver tus entrenamientos, medidas y dieta, dejarte notas y asignarte planes. Puedes salir cuando quieras.
• Si eres coach, administra a tus atletas desde una sola cartera.

TU PRIVACIDAD
• Sin anuncios, sin rastreo y sin venta de datos.
• Inicia sesión con correo y contraseña, con Google o con Apple (en iPhone).
• Puedes eliminar tu cuenta y tus datos desde la app, en Perfil, Ajustes.
• Para mayores de 18 años.

Alzo es una herramienta informativa de registro y análisis. No ofrece diagnóstico, tratamiento ni consejo médico ni nutricional. Consulta a un profesional de la salud antes de cambiar tu entrenamiento o tu alimentación, sobre todo si tienes una condición médica.
```

## Verificar antes de pegar

- "Programa tus semanas y ciclos": corresponde a `/training/plan` (Programación). Si
  el flujo de ciclos no está visible en la versión que subes, quita "y ciclos".
- "Registra series por voz": solo funciona si el build se hizo con
  `VITE_ENABLE_OFFLINE_VOICE_CAPTURE=true` (en `frontend/.env.mobile.example` figura así;
  el CI de iOS lo fuerza). Si no, quita esa viñeta.
- La línea de Apple en "Tu privacidad" no aplica a Google Play: en Play, cámbiala por
  "Inicia sesión con correo y contraseña o con Google."
- El texto del modo coach describe lo que ve el coach según la política de privacidad
  (`frontend/src/pages/legal/PrivacyPolicy.tsx`); mantén ambos alineados.
- Apple rechaza (guideline 2.3) capturas o textos que mencionen otras plataformas o
  funciones que la app no tiene. No añadas "sincroniza con Apple Salud / Google Fit":
  la app no se conecta a ellos.
