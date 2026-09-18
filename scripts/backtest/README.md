# Backtest del motor de predicción contra datos reales

Dos datasets, dos regímenes:

| Script | Dataset | Régimen | Qué mide |
|---|---|---|---|
| `opl_backtest.py` | OpenPowerlifting | Competencias separadas por meses | Fuera del dominio del motor |
| `gc_backtest.py` + `gc_fetch.py` | GoldenCheetah OpenData | Sesiones diarias durante años | **Dentro** del dominio del motor |
| `gym_backtest.py` + `gym_fetch.py` | Logs de Strong/FitNotes publicados en GitHub | Gimnasio, sesión a sesión | **Dominio exacto de Alzo** |

Sembrar datos sintéticos solo prueba que el pipeline corre. Para saber si el
motor **predice** hay que darle un prefijo de una historia real y comparar lo que
dice con lo que de verdad pasó después (*rolling-origin*: el prefijo nunca ve el
futuro).

## Dataset

[OpenPowerlifting](https://openpowerlifting.gitlab.io/opl-csv/bulk-csv.html) —
dominio público, ~4M filas, ~800k levantadores, resultados de competencia
fechados desde los años 60. Se descarga aparte (162 MB comprimido, 786 MB de
CSV); **no vive en el repo**.

```bash
curl -L -o opl.zip https://openpowerlifting.gitlab.io/opl-csv/files/openpowerlifting-latest.zip
unzip opl.zip
python scripts/backtest/opl_backtest.py openpowerlifting-*/openpowerlifting-*.csv \
    --lifters 300 --horizon 2 --cohort-cache cohorte.json
```

Cohorte: potencia completa (`SBD`), `Raw`, sin descalificados, ≥ 10 meets por
levantador. Cada meet se traduce a una sesión con tres ejercicios de una serie a
una repetición, así el `volume_load_kg` del motor coincide con el total de
competencia.

## Qué se evalúa

Solo lo falsable sin contrafactual:

1. **Dirección de tendencia** (`up`/`stable`/`down`) del último punto del
   prefijo, contra el cambio real del total en los siguientes *H* meets (banda
   muerta de ±2.5 % para no premiar ruido).
2. **`plateau`** (probabilidad latente) contra "no hubo mejora" en ese mismo
   horizonte: Brier, AUC y tabla de calibración.

Los escenarios sugeridos (`recovery` / `maintenance` / `variation`) son
prescriptivos: no se pueden falsear sin saber qué habría pasado si el atleta
hubiera hecho caso. No se evalúan aquí.

Baselines obligatorios (si el motor no les gana, no aporta): decir siempre
"estable", repetir el signo del último cambio, y el signo de la pendiente OLS del
prefijo.

## Resultado (2026-09-17, 300 levantadores, 2084 predicciones)

| Predictor | Acierto de dirección |
|---|---|
| Motor (`slope_threshold_norm` por defecto, 0.05) | 44.3 % |
| Baseline "siempre estable" | 44.1 % |
| Baseline persistencia | 37.3 % |
| Baseline pendiente OLS | 34.9 % |

El motor dijo `stable` en **2077 de 2084** casos: empata con el predictor
constante porque es, en la práctica, un predictor constante. Bajando el umbral
para que se comprometa, empeora (0.002 → 39.4 %; 0.0005 → 34.0 %, ambos por
debajo del baseline trivial).

`plateau`: Brier **0.556** contra **0.239** de predecir siempre la prevalencia
observada (39.4 %), AUC **0.547**. La calibración explica por qué: en el 97 % de
los casos el motor devuelve ≈0.97, mientras la tasa real de "sin mejora" en ese
mismo grupo es 0.40.

## Limitaciones honestas de este backtest

- OpenPowerlifting **no es un log de entrenamiento**: los puntos están meses
  apart, cada uno es un intento máximo en competencia, y están confundidos por
  picos de forma, categorías de peso, cortes de agua y edad. El motor está
  diseñado para sesiones densas. Esto mide al motor **fuera de su dominio**.
- Aun así, la app muestra esos mismos números al usuario como "estado estimado".
  Una probabilidad que vale 0.97 siempre no informa una decisión, venga del
  dominio que venga.
- El horizonte por defecto (2 meets) es corto; con horizontes largos hay menos
  puntos por levantador.

---

# GoldenCheetah OpenData: entrenos densos día a día

[Proyecto OSF 6hfpz](https://osf.io/6hfpz/), DOI
[10.17605/OSF.IO/6HFPZ](https://doi.org/10.17605/OSF.IO/6HFPZ). **6614 atletas**,
cada uno un zip con un JSON de resumen (una entrada por sesión, con métricas ya
calculadas) más los CSV segundo a segundo. Anonimizado, sin GPS ni PII.

```bash
python scripts/backtest/gc_fetch.py --out /tmp/gc --athletes 25
python scripts/backtest/gc_backtest.py /tmp/gc
```

Cada sesión entra al motor con su duración y un RPE derivado del Intensity
Factor (IF×10), así el motor calcula su propia métrica `srpe_load` (carga
interna = duración × RPE), que es una medida estándar y no un invento del
script.

Se evalúan dos cosas que conviene no mezclar:

- **E1 — carga futura**: la dirección de tendencia contra la carga real de las 4
  semanas siguientes. La carga la elige el atleta, así que acertar aquí es útil
  pero no es "predecir progreso".
- **E2 — rendimiento futuro**: el estado del motor en el día *t* contra lo que
  hace el mejor 20 min de potencia (20mCP, proxy estándar de forma) en los 28
  días siguientes frente a los 28 anteriores. Esto sí es progreso.

## Resultado (2026-09-17, 18 atletas, 330 evaluaciones)

| | Motor (todas) | Motor (solo cuando se compromete) | Clase mayoritaria | Persistencia |
|---|---|---|---|---|
| E1 carga | 23.3 % | 31.4 % | **42.7 %** | — |
| E2 rendimiento | 25.2 % | 33.9 % (n=245) | **40.3 %** | 24.8 % |

`plateau` contra "no hubo mejora": Brier **0.484** frente a **0.250** de predecir
la prevalencia; **AUC 0.475**, o sea por debajo del azar.

Aquí el motor **sí** usa las tres direcciones (up 75 / stable 81 / down 89 /
volatile 85): con datos densos la derivada por día funciona y deja de ser el
predictor constante que era con OpenPowerlifting. Pero al comprometerse acierta
menos que decir siempre la clase más frecuente, tanto para la carga futura como
para el rendimiento futuro.

## Limitaciones de este segundo backtest

- 18 atletas y 330 puntos: el intervalo de confianza del 33.9 % ronda ±6 pp. La
  distancia contra el 40.3 % es consistente, pero no es una muestra grande.
- Es ciclismo, no fuerza. La aritmética de tendencias y latentes es agnóstica al
  deporte (EWMA de carga), así que el test es justo para esa capa; la capa de
  escenarios sigue sin evaluarse.
- El RPE sale del IF, no lo reportó el atleta.
- El 20mCP de una ventana depende de que el atleta haya hecho un esfuerzo duro
  en esos 28 días; es una medida ruidosa de forma.

---

# Logs reales de gimnasio (Strong / FitNotes)

No existe —a septiembre de 2026— un dataset público grande de entrenamiento de
fuerza sesión a sesión. Lo que sí hay son **exports personales que sus dueños
subieron a repos públicos**. `gym_fetch.py` los busca por la cabecera exacta de
cada exportador, descarta plantillas de ejemplo y se queda con los historiales
de ≥ 40 días distintos.

```bash
python scripts/backtest/gym_fetch.py --out /tmp/gymlogs   # necesita `gh` autenticado
python scripts/backtest/gym_backtest.py /tmp/gymlogs
```

Cosecha de 2026-09-18: **28 logs útiles**, de 41 a 256 días de entreno cada uno.
Los CSV son de terceros: se descargan al vuelo, **no** se guardan en este repo.

Este es el test que de verdad importa para Alzo: mismos datos que registra la
app (fecha, ejercicio, series, repeticiones, peso) y la misma métrica que muestra
(`volume_load_kg`).

- **E1 — volumen futuro**: dirección de tendencia contra el volumen real de las 4
  semanas siguientes.
- **E2 — fuerza futura**: 1RM estimado (Epley) del ejercicio principal del atleta
  en los 28 días siguientes contra los 28 anteriores.

## Resultado (27 atletas, 343 evaluaciones)

| | Motor (todas) | Motor (comprometido) | Clase mayoritaria | Persistencia |
|---|---|---|---|---|
| E1 volumen | 30.9 % | 31.6 % | **42.0 %** | — |
| E2 fuerza (1RM est.) | 35.9 % | 36.7 % (n=335) | **53.4 %** | 38.2 % |

`plateau` contra "no hubo mejora": Brier **0.375** frente a **0.235** de predecir
la prevalencia; **AUC 0.460**, por debajo del azar.

Aquí el motor sí reparte sus etiquetas (up 81 / stable 171 / down 83 / volatile
8), o sea que el problema no es que se quede mudo: es que **cuando habla, acierta
menos que decir siempre "va a subir"**, que es lo que pasa el 53 % de las veces.

## Los tres experimentos, juntos

| Dataset | Régimen | Motor | Mejor baseline trivial |
|---|---|---|---|
| OpenPowerlifting | Competencias, meses aparte | 44.3 % | 44.1 % (constante) |
| GoldenCheetah | Ciclismo, diario | 33.9 % | 40.3 % |
| Strong/FitNotes | **Gimnasio, sesión a sesión** | 36.7 % | 53.4 % |

En los tres, la probabilidad de estancamiento tiene AUC entre 0.46 y 0.59 (azar
= 0.50) y un Brier peor que predecir la tasa base. El patrón se repite fuera y
dentro del dominio, con dos deportes y tres fuentes independientes.

## Qué hacer con esto

No es que el pipeline esté roto: corre, no explota y las cuentas son las que
dice el código. Es que **no informa una decisión**. Opciones, de menos a más
trabajo:

1. Dejar de presentar `plateau`/`fatiga`/`disposición` como porcentajes con
   pinta de predicción y describirlos como lo que son: descriptores del pasado
   reciente.
2. Calibrar los umbrales y la sigmoide contra estos backtests (hay 6614 atletas
   en GoldenCheetah y 28 logs de gimnasio ya descargables) y volver a medir.
3. Sustituir la capa de latentes por un modelo entrenado y validado con estos
   mismos datos, con la barra puesta en superar la clase mayoritaria.

---

# Vías de mejora, medidas (2026-09-18)

Se probaron cuatro de las seis vías propuestas. Tres se pudieron medir con
datos; una no.

## Vía 1 — meter RPE y wellness (`next_set_probe.py`, ablación)

De los 28 logs cosechados, **solo 6 traen RPE poblado** (769 de 4346 muestras).
`wellness_signals` no existe fuera de Alzo: ningún exportador público lo tiene.

Ablación quitando las features de RPE: MAE 6.70 kg con ellas, **6.64 kg sin
ellas**. No aporta — con esta cobertura de datos no se puede concluir otra cosa.
La feature se puede implementar, pero **su valor está sin demostrar** hasta
tener datos propios de usuarios de Alzo.

## Vía 2 — cambiar el objetivo a "próxima serie tope" (`next_set_probe.py`)

4346 muestras, 28 atletas, 4 ejercicios principales por atleta, validación
leave-one-athlete-out.

| Predictor | MAE (kg) | Dentro de ±2.5 kg |
|---|---|---|
| **Persistencia** (repetir el último tope) | **6.14** | **62.8 %** |
| Media de 3 | 6.34 | — |
| Mediana pinball + shrinkage | 6.44 | 51.2 % |
| Ridge sobre delta relativo | 6.70 | 49.1 % |
| Extrapolación lineal | 8.76 | — |

**Persistencia gana**, y no por poco en la métrica que importa al usuario
(±2.5 kg: 63 % contra 51 %). La razón está en la distribución del objetivo:
**el 46 % de los deltas es exactamente 0** y el 63 % cae dentro de ±2.5 kg;
mediana 0 kg, p90 15.9 kg. Es una distribución con un pico en cero y colas
largas: cualquier modelo que prediga un delta distinto de cero empeora la
mayoría de los casos para acertar unos pocos saltos.

Se intentaron tres correcciones sucesivas, todas documentadas en el script:
predecir delta relativo en vez de kg absolutos (7.21 → 6.70), regresión de
mediana en vez de mínimos cuadrados (→ 6.45), y shrinkage hacia persistencia
más redondeo a la rejilla de discos del propio atleta (→ 6.44). Ninguna alcanza
el baseline.

**Lectura de producto**: para "qué vas a mover hoy" lo correcto es mostrar el
último peso con un intervalo, no una predicción de modelo.

## Vía 3 — calibración (`calibrate_plateau.py`)

| | Brier | Skill score | Probabilidad media |
|---|---|---|---|
| `plateau` crudo | 0.381 | −0.610 | 0.065 |
| `plateau` calibrado | **0.249** | **−0.050** | 0.379 |
| Predecir la tasa base | 0.237 | 0.000 | 0.386 |

Funciona como se esperaba: calibrar cierra casi toda la brecha de Brier y hace
que el número **signifique lo que dice** (0.379 contra una tasa real de 0.386).
Lo que no hace es crear información: el skill sigue negativo.

El diagnóstico de por qué: **`plateau` vale exactamente 0 en el 75 % de los
casos** en logs de gimnasio (en OpenPowerlifting valía ~0.97 casi siempre), y la
tasa real de "sin mejora" es 0.43 / 0.35 / 0.37 en los tres terciles de
`plateau`. No separa nada.

## Vía 6 — incertidumbre honesta (conformal, en `next_set_probe.py`)

Conformal split, objetivo 90 %: **cobertura empírica 92.8 %**. Los intervalos
son honestos. El problema es el ancho: mediana **35 kg**, porque la cola del
objetivo es larga. Un intervalo honesto y ancho es más útil que un número
puntual falso, pero hay que presentarlo bien.

## Conclusión operativa

1. La predicción puntual del próximo tope **es** la persistencia. Mostrar eso.
2. `plateau` o se calibra (y entonces dice ~38 % siempre, honesto pero inútil) o
   se quita de la UI.
3. Antes de invertir en modelos más complejos (pooling jerárquico real,
   fitness-fatigue, GBM) hace falta **más datos y mejores señales**: RPE real por
   serie y wellness, que solo van a llegar de usuarios de Alzo.

---

# Dosis-respuesta: ¿cuánta fuerza gano según lo que entreno? (`dose_response.py`)

El objetivo que pidió el producto. No es pronóstico de una serie temporal: es
**respuesta condicionada a la dosis**, donde la variable explicativa (cuánto
entrenas) es una acción del usuario.

Unidad: bloques de 4 semanas. `X` = dosis del bloque *k* (series duras/semana,
frecuencia, esfuerzo, nivel de partida), `y` = cambio de e1RM (%) del ejercicio
principal entre el bloque *k* y el *k+1*. Modelo multinivel: efecto poblacional
(ridge) + intercepto por atleta encogido `n/(n+k)`.

## Resultado (291 bloques, 29 atletas)

| Escenario | Modelo | Predecir 0 | Media poblacional | Media del atleta |
|---|---|---|---|---|
| Cold start (atleta nuevo) | 8.46 % | 8.38 % | **8.30 %** | — |
| Personalizado (último bloque) | 7.94 % | **7.18 %** | — | 9.82 % |

**Coeficiente dosis → ganancia: +0.019, IC95 % bootstrap [−0.011, +0.057].
Correlación simple: 0.065.**

El intervalo cruza el cero. El signo es el que dice la literatura (más series →
más ganancia) y la magnitud es plausible, pero **con 29 atletas no hay potencia
para afirmarlo**: el cambio de e1RM por bloque tiene σ = 17.9 %, y el efecto
buscado es de pocos puntos porcentuales.

Se probaron dos correcciones de análisis, ambas peores: e1RM robusto (mediana de
los tres mejores, σ subió a 19.1 %) y bloques de 8 semanas (σ 27.4 %).

Para que el IC no cruce cero haría falta reducir el error estándar a la mitad:
**del orden de 120 atletas con ~10 bloques cada uno**. El bootstrap es por
atleta, no por fila, porque los bloques de una misma persona no son
independientes.

**Por eso el modelo no se enchufó como predictor.** Lo que sí se aplicó es la
capa honesta (`coach_ai.insights`) y el registro de predicciones, que es lo que
permitirá repetir esta medición con datos propios y prescripción real — que los
logs públicos no tienen.

## Pendiente

- Más atletas de GoldenCheetah (hay 6614; aquí se usaron 25 descargas).
- [721 Weight Training Workouts](https://www.kaggle.com/datasets/joep89/weightlifting)
  (Kaggle, 3 años de un sujeto) — necesita credenciales de Kaggle.
- Datos individuales abiertos de estudios en OSF, p. ej. el ensayo replicado
  intra-sujeto de volumen ([osf.io/aw5zx](https://osf.io/aw5zx)).
