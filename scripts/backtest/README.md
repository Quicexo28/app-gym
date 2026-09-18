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

## Pendiente

- Más atletas de GoldenCheetah (hay 6614; aquí se usaron 25 descargas).
- [721 Weight Training Workouts](https://www.kaggle.com/datasets/joep89/weightlifting)
  (Kaggle, 3 años de un sujeto) — necesita credenciales de Kaggle.
- Datos individuales abiertos de estudios en OSF, p. ej. el ensayo replicado
  intra-sujeto de volumen ([osf.io/aw5zx](https://osf.io/aw5zx)).
