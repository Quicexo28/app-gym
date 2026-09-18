# Backtest del motor de predicción contra datos reales

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

## Siguiente paso

Repetir con **logs por sesión**, que es la entrada real de la app:

- [721 Weight Training Workouts](https://www.kaggle.com/datasets/joep89/weightlifting)
  (Kaggle, 3 años de un mismo sujeto) — necesita credenciales de Kaggle.
- Datos individuales abiertos de estudios longitudinales en OSF, p. ej. el
  ensayo replicado intra-sujeto de volumen ([osf.io/aw5zx](https://osf.io/aw5zx)).
- El propio histórico del usuario cuando haya suficientes sesiones.
