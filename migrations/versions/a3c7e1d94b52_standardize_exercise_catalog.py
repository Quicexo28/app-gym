"""standardize_exercise_catalog

Revision ID: a3c7e1d94b52
Revises: 8ffd333464cb
Create Date: 2026-11-12 00:00:00.000000

Estandariza el catalogo global de ejercicios a:
    Grupo > Ejercicio > Equipo > Variante
- Ejercicio: movimiento base (estilos distintos son ejercicio propio: Curl Martillo).
- Equipo: vocabulario fijo (Con Barra, Con Mancuernas, En Polea, En Maquina, En Smith,
  En Hammer, En Hack, En Prensa, Con Disco, Con Peso Corporal, Peso Libre).
- Variante: agarre, inclinacion o postura. "Unilateral" va al final; "Bilateral" se
  quita (es el valor por defecto).
Los ejercicios personalizados (owner_user_id no nulo) no se tocan.
Los nombres guardados como texto (sesiones, rutinas, indice, logs) se reescriben con
NAME_MAP para que el historial siga coincidiendo con el catalogo.
No es reversible: varios nombres viejos se fusionan en uno nuevo.
"""

import json
import re
import unicodedata
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a3c7e1d94b52"
down_revision: Union[str, Sequence[str], None] = "8ffd333464cb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (grupo, ejercicio, equipo, variante); "" = nivel vacio.
NEW_ROWS = [
    ("Abdominales", "Elevaciones de Piernas", "", ""),
    ("Abdominales", "Elevaciones de Piernas", "", "En Barra Colgado"),
    ("Abdominales", "Encogimientos (Crunches)", "", ""),
    ("Abdominales", "Encogimientos (Crunches)", "En Máquina", ""),
    ("Abdominales", "Plancha", "", ""),
    ("Abdominales", "Press Pallof", "", ""),
    ("Abdominales", "Press Pallof", "En Polea", ""),
    ("Abductores", "Abducción de Cadera", "", ""),
    ("Abductores", "Abducción de Cadera", "En Máquina", ""),
    ("Abductores", "Abducción de Cadera", "En Máquina", "De Pie"),
    ("Abductores", "Abducción de Cadera", "En Máquina", "Sentado"),
    ("Abductores", "Abducción de Cadera", "En Polea", ""),
    ("Aductores", "Aducción de Cadera", "", ""),
    ("Aductores", "Aducción de Cadera", "En Máquina", ""),
    ("Aductores", "Aducción de Cadera", "En Máquina", "De Pie"),
    ("Aductores", "Aducción de Cadera", "En Máquina", "Sentado"),
    ("Aductores", "Aducción de Cadera", "En Polea", ""),
    ("Bíceps", "Curl Bayesian", "", ""),
    ("Bíceps", "Curl Bayesian", "Con Mancuernas", ""),
    ("Bíceps", "Curl Bayesian", "Con Mancuernas", "En Banco Inclinado"),
    ("Bíceps", "Curl Bayesian", "En Hammer", ""),
    ("Bíceps", "Curl Bayesian", "En Hammer", "Unilateral"),
    ("Bíceps", "Curl Bayesian", "En Máquina", ""),
    ("Bíceps", "Curl Bayesian", "En Máquina", "Unilateral"),
    ("Bíceps", "Curl Bayesian", "En Polea", ""),
    ("Bíceps", "Curl Bayesian", "En Polea", "Unilateral"),
    ("Bíceps", "Curl Martillo", "", ""),
    ("Bíceps", "Curl Martillo", "Con Mancuernas", ""),
    ("Bíceps", "Curl Martillo", "Con Mancuernas", "Alternado"),
    ("Bíceps", "Curl Martillo", "Con Mancuernas", "Unilateral"),
    ("Bíceps", "Curl Martillo", "En Polea", ""),
    ("Bíceps", "Curl Martillo", "En Polea", "Unilateral"),
    ("Bíceps", "Curl Predicador", "", ""),
    ("Bíceps", "Curl Predicador", "Con Barra", ""),
    ("Bíceps", "Curl Predicador", "Con Mancuernas", ""),
    ("Bíceps", "Curl Predicador", "Con Mancuernas", "Unilateral"),
    ("Bíceps", "Curl Predicador", "En Hammer", ""),
    ("Bíceps", "Curl Predicador", "En Hammer", "Unilateral"),
    ("Bíceps", "Curl Predicador", "En Máquina", ""),
    ("Bíceps", "Curl Predicador", "En Máquina", "Unilateral"),
    ("Bíceps", "Curl Predicador", "En Polea", ""),
    ("Bíceps", "Curl Predicador", "En Polea", "Unilateral"),
    ("Bíceps", "Curl Spider", "", ""),
    ("Bíceps", "Curl Spider", "Con Barra", ""),
    ("Bíceps", "Curl Spider", "Con Mancuernas", ""),
    ("Bíceps", "Curl Spider", "Con Mancuernas", "Unilateral"),
    ("Bíceps", "Curl de Bíceps", "", ""),
    ("Bíceps", "Curl de Bíceps", "Con Barra", ""),
    ("Bíceps", "Curl de Bíceps", "Con Mancuernas", ""),
    ("Bíceps", "Curl de Bíceps", "Con Mancuernas", "Alternado"),
    ("Bíceps", "Curl de Bíceps", "Con Mancuernas", "Unilateral"),
    ("Bíceps", "Curl de Bíceps", "En Polea", ""),
    ("Bíceps", "Curl de Bíceps", "En Polea", "Unilateral"),
    ("Cuádriceps", "Extensión de Cuádriceps", "", ""),
    ("Cuádriceps", "Extensión de Cuádriceps", "En Hammer", ""),
    ("Cuádriceps", "Extensión de Cuádriceps", "En Hammer", "Unilateral"),
    ("Cuádriceps", "Extensión de Cuádriceps", "En Máquina", ""),
    ("Cuádriceps", "Extensión de Cuádriceps", "En Máquina", "Unilateral"),
    ("Cuádriceps", "Prensa de Piernas", "", ""),
    ("Cuádriceps", "Prensa de Piernas", "En Máquina", ""),
    ("Cuádriceps", "Prensa de Piernas", "En Máquina", "Unilateral"),
    ("Cuádriceps", "Sentadilla", "", ""),
    ("Cuádriceps", "Sentadilla", "Con Barra", ""),
    ("Cuádriceps", "Sentadilla", "Con Barra", "Frontal"),
    ("Cuádriceps", "Sentadilla", "Con Barra", "Trasera"),
    ("Cuádriceps", "Sentadilla", "En Hack", ""),
    ("Cuádriceps", "Sentadilla", "En Smith", ""),
    ("Cuádriceps", "Sentadilla", "En Smith", "Frontal"),
    ("Cuádriceps", "Sentadilla", "En Smith", "Trasera"),
    ("Cuádriceps", "Sentadilla Búlgara", "", ""),
    ("Cuádriceps", "Sentadilla Búlgara", "Con Barra", ""),
    ("Cuádriceps", "Sentadilla Búlgara", "Con Mancuernas", ""),
    ("Cuádriceps", "Sentadilla Búlgara", "En Smith", ""),
    ("Espalda", "Dominadas", "", ""),
    ("Espalda", "Dominadas", "Con Peso Corporal", ""),
    ("Espalda", "Dominadas", "Con Peso Corporal", "Agarre Neutro"),
    ("Espalda", "Dominadas", "Con Peso Corporal", "Agarre Prono (Pull-Up)"),
    ("Espalda", "Dominadas", "Con Peso Corporal", "Agarre Supino (Chin-Up)"),
    ("Espalda", "Face Pull", "", ""),
    ("Espalda", "Face Pull", "En Polea", ""),
    ("Espalda", "Face Pull", "En Polea", "Con Cuerda"),
    ("Espalda", "Jalón al Pecho", "", ""),
    ("Espalda", "Jalón al Pecho", "En Máquina", ""),
    ("Espalda", "Jalón al Pecho", "En Máquina", "Agarre Neutro"),
    ("Espalda", "Jalón al Pecho", "En Máquina", "Agarre Neutro Unilateral"),
    ("Espalda", "Jalón al Pecho", "En Máquina", "Agarre Prono"),
    ("Espalda", "Jalón al Pecho", "En Máquina", "Agarre Supino"),
    ("Espalda", "Jalón al Pecho", "En Polea", ""),
    ("Espalda", "Jalón al Pecho", "En Polea", "Agarre Neutro"),
    ("Espalda", "Jalón al Pecho", "En Polea", "Agarre Neutro Unilateral"),
    ("Espalda", "Jalón al Pecho", "En Polea", "Agarre Prono"),
    ("Espalda", "Jalón al Pecho", "En Polea", "Agarre Supino"),
    ("Espalda", "Keenan Flap", "", ""),
    ("Espalda", "Pull Over", "", ""),
    ("Espalda", "Pull Over", "En Máquina", ""),
    ("Espalda", "Pull Over", "En Polea", ""),
    ("Espalda", "Pull Over", "En Polea", "De Pie"),
    ("Espalda", "Pull Over", "En Polea", "De Pie Unilateral"),
    ("Espalda", "Pull Over", "En Polea", "En Banco"),
    ("Espalda", "Pull Over", "En Polea", "En Banco Unilateral"),
    ("Espalda", "Remo", "", ""),
    ("Espalda", "Remo", "Con Barra", ""),
    ("Espalda", "Remo", "Con Barra", "A la Cadera"),
    ("Espalda", "Remo", "Con Barra", "Al Pecho"),
    ("Espalda", "Remo", "Con Mancuernas", ""),
    ("Espalda", "Remo", "Con Mancuernas", "Agarre Neutro"),
    ("Espalda", "Remo", "Con Mancuernas", "Agarre Neutro Unilateral"),
    ("Espalda", "Remo", "Con Mancuernas", "Agarre Prono"),
    ("Espalda", "Remo", "Con Mancuernas", "Agarre Supino"),
    ("Espalda", "Remo", "Con Mancuernas", "Agarre Supino Unilateral"),
    ("Espalda", "Remo", "En Máquina", ""),
    ("Espalda", "Remo", "En Máquina", "Hammer"),
    ("Espalda", "Remo", "En Máquina", "Máquina"),
    ("Espalda", "Remo", "En Polea", ""),
    ("Espalda", "Remo", "En Polea", "Agarre Neutro"),
    ("Espalda", "Remo", "En Polea", "Agarre Neutro Unilateral"),
    ("Espalda", "Remo", "En Polea", "Agarre Prono"),
    ("Espalda", "Remo", "En Polea", "Agarre Supino"),
    ("Espalda", "Remo", "En Polea", "Agarre Supino Unilateral"),
    ("Espalda", "Remo en Barra T", "", ""),
    ("Espalda", "Remo en Barra T", "Con Barra", ""),
    ("Espalda", "Remo en Barra T", "Con Barra", "Con Apoyo"),
    ("Espalda", "Remo en Barra T", "Con Barra", "Sin Apoyo"),
    ("Femorales", "Buenos Días", "", ""),
    ("Femorales", "Buenos Días", "Con Barra", ""),
    ("Femorales", "Curl Femoral", "", ""),
    ("Femorales", "Curl Femoral", "En Máquina", ""),
    ("Femorales", "Curl Femoral", "En Máquina", "Acostado"),
    ("Femorales", "Curl Femoral", "En Máquina", "Acostado Unilateral"),
    ("Femorales", "Curl Femoral", "En Máquina", "Sentado"),
    ("Femorales", "Curl Femoral", "En Máquina", "Sentado Unilateral"),
    ("Femorales", "Hiperextensiones", "", ""),
    ("Femorales", "Hiperextensiones", "Con Disco", ""),
    ("Femorales", "Peso Muerto", "", ""),
    ("Femorales", "Peso Muerto", "Con Barra", ""),
    ("Femorales", "Peso Muerto", "Con Barra", "Convencional"),
    ("Femorales", "Peso Muerto", "Con Barra", "Sumo"),
    ("Femorales", "Peso Muerto Piernas Rígidas", "", ""),
    ("Femorales", "Peso Muerto Piernas Rígidas", "Con Barra", ""),
    ("Femorales", "Peso Muerto Piernas Rígidas", "Con Mancuernas", ""),
    ("Femorales", "Peso Muerto Rumano", "", ""),
    ("Femorales", "Peso Muerto Rumano", "Con Barra", ""),
    ("Femorales", "Peso Muerto Rumano", "Con Mancuernas", ""),
    ("Femorales", "Peso Muerto Rumano", "Con Mancuernas", "Unilateral"),
    ("Glúteos", "Hip Thrust", "", ""),
    ("Glúteos", "Hip Thrust", "Con Barra", ""),
    ("Glúteos", "Hip Thrust", "En Hammer", ""),
    ("Glúteos", "Hip Thrust", "En Hammer", "De Brazo"),
    ("Glúteos", "Hip Thrust", "En Hammer", "De Correa"),
    ("Glúteos", "Hip Thrust", "En Máquina", ""),
    ("Glúteos", "Hip Thrust", "En Smith", ""),
    ("Glúteos", "Patada de Glúteo", "", ""),
    ("Glúteos", "Patada de Glúteo", "En Máquina", ""),
    ("Glúteos", "Patada de Glúteo", "En Polea", ""),
    ("Glúteos", "Patada de Glúteo", "En Polea", "Polea Baja"),
    ("Glúteos", "Patada de Glúteo", "En Polea", "Polea Media"),
    ("Glúteos", "Puente de Glúteos", "", ""),
    ("Glúteos", "Puente de Glúteos", "Con Barra", ""),
    ("Glúteos", "Puente de Glúteos", "Con Peso Corporal", ""),
    ("Glúteos", "Puente de Glúteos", "Con Peso Corporal", "Unilateral"),
    ("Hombros", "Elevaciones Frontales", "", ""),
    ("Hombros", "Elevaciones Frontales", "Con Mancuernas", ""),
    ("Hombros", "Elevaciones Frontales", "Con Mancuernas", "Unilateral"),
    ("Hombros", "Elevaciones Frontales", "En Polea", ""),
    ("Hombros", "Elevaciones Frontales", "En Polea", "Unilateral"),
    ("Hombros", "Elevaciones Laterales", "", ""),
    ("Hombros", "Elevaciones Laterales", "Con Mancuernas", ""),
    ("Hombros", "Elevaciones Laterales", "Con Mancuernas", "De Pie"),
    ("Hombros", "Elevaciones Laterales", "Con Mancuernas", "De Pie Unilateral"),
    ("Hombros", "Elevaciones Laterales", "Con Mancuernas", "En Banco"),
    ("Hombros", "Elevaciones Laterales", "Con Mancuernas", "En Banco Unilateral"),
    ("Hombros", "Elevaciones Laterales", "En Hammer", ""),
    ("Hombros", "Elevaciones Laterales", "En Hammer", "Unilateral"),
    ("Hombros", "Elevaciones Laterales", "En Máquina", ""),
    ("Hombros", "Elevaciones Laterales", "En Máquina", "Unilateral"),
    ("Hombros", "Elevaciones Laterales", "En Polea", ""),
    ("Hombros", "Elevaciones Laterales", "En Polea", "Unilateral"),
    ("Hombros", "Press de Hombros (Press Militar)", "", ""),
    ("Hombros", "Press de Hombros (Press Militar)", "Con Barra", ""),
    ("Hombros", "Press de Hombros (Press Militar)", "Con Mancuernas", ""),
    ("Hombros", "Press de Hombros (Press Militar)", "En Hammer", ""),
    ("Hombros", "Press de Hombros (Press Militar)", "En Máquina", ""),
    ("Hombros", "Press de Hombros (Press Militar)", "En Smith", ""),
    ("Hombros", "Vuelos Posteriores", "", ""),
    ("Hombros", "Vuelos Posteriores", "Con Mancuernas", ""),
    ("Hombros", "Vuelos Posteriores", "En Máquina", ""),
    ("Hombros", "Vuelos Posteriores", "En Máquina", "Pec Deck Inverso"),
    ("Hombros", "Vuelos Posteriores", "En Polea", ""),
    ("Hombros", "Vuelos Posteriores", "En Polea", "Unilateral"),
    ("Pantorrillas", "Elevación de Talones", "", ""),
    ("Pantorrillas", "Elevación de Talones", "Con Barra", ""),
    ("Pantorrillas", "Elevación de Talones", "Con Barra", "Unilateral"),
    ("Pantorrillas", "Elevación de Talones", "Con Peso Corporal", ""),
    ("Pantorrillas", "Elevación de Talones", "Con Peso Corporal", "Unilateral"),
    ("Pantorrillas", "Elevación de Talones", "En Hack", ""),
    ("Pantorrillas", "Elevación de Talones", "En Hack", "Unilateral"),
    ("Pantorrillas", "Elevación de Talones", "En Prensa", ""),
    ("Pantorrillas", "Elevación de Talones", "En Prensa", "Unilateral"),
    ("Pantorrillas", "Elevación de Talones", "En Smith", ""),
    ("Pantorrillas", "Elevación de Talones", "En Smith", "Unilateral"),
    ("Pantorrillas", "Elevación de Talones Sentado", "", ""),
    ("Pecho", "Aperturas", "", ""),
    ("Pecho", "Aperturas", "Con Mancuernas", ""),
    ("Pecho", "Aperturas", "Con Mancuernas", "Declinado"),
    ("Pecho", "Aperturas", "En Hammer", ""),
    ("Pecho", "Aperturas", "En Máquina", ""),
    ("Pecho", "Cruces", "", ""),
    ("Pecho", "Cruces", "En Polea", ""),
    ("Pecho", "Cruces", "En Polea", "Ascendente"),
    ("Pecho", "Cruces", "En Polea", "Ascendente Unilateral"),
    ("Pecho", "Cruces", "En Polea", "Descendente"),
    ("Pecho", "Cruces", "En Polea", "Descendente Unilateral"),
    ("Pecho", "Cruces", "En Polea", "Recto"),
    ("Pecho", "Cruces", "En Polea", "Recto Unilateral"),
    ("Pecho", "Press", "", ""),
    ("Pecho", "Press", "En Hammer", ""),
    ("Pecho", "Press", "En Hammer", "Declinado"),
    ("Pecho", "Press", "En Hammer", "Inclinado"),
    ("Pecho", "Press", "En Hammer", "Plano"),
    ("Pecho", "Press", "En Máquina", ""),
    ("Pecho", "Press", "En Máquina", "Declinado"),
    ("Pecho", "Press", "En Máquina", "Inclinado"),
    ("Pecho", "Press", "En Máquina", "Plano"),
    ("Pecho", "Press", "En Smith", ""),
    ("Pecho", "Press", "En Smith", "Declinado"),
    ("Pecho", "Press", "En Smith", "Inclinado"),
    ("Pecho", "Press", "En Smith", "Plano"),
    ("Pecho", "Press", "Peso Libre", ""),
    ("Pecho", "Press", "Peso Libre", "Declinado"),
    ("Pecho", "Press", "Peso Libre", "Inclinado"),
    ("Pecho", "Press", "Peso Libre", "Plano"),
    ("Tríceps", "Extensiones", "", ""),
    ("Tríceps", "Extensiones", "Por Debajo de la Cabeza", ""),
    ("Tríceps", "Extensiones", "Por Debajo de la Cabeza", "Unilateral"),
    ("Tríceps", "Extensiones", "Por Encima de la Cabeza", ""),
    ("Tríceps", "Extensiones", "Por Encima de la Cabeza", "Katana"),
    ("Tríceps", "Extensiones", "Por Encima de la Cabeza", "Katana Unilateral"),
    ("Tríceps", "Patada", "", ""),
    ("Tríceps", "Patada", "Con Mancuernas", ""),
    ("Tríceps", "Patada", "Con Mancuernas", "Unilateral"),
    ("Tríceps", "Patada", "En Polea", ""),
    ("Tríceps", "Patada", "En Polea", "De Pie"),
    ("Tríceps", "Patada", "En Polea", "De Pie Unilateral"),
    ("Tríceps", "Patada", "En Polea", "Inclinado"),
    ("Tríceps", "Patada", "En Polea", "Inclinado Unilateral"),
    ("Tríceps", "Press Cerrado", "", ""),
    ("Tríceps", "Press Cerrado", "En Hammer", ""),
    ("Tríceps", "Press Cerrado", "En Smith", ""),
    ("Tríceps", "Press Cerrado", "Peso Libre", ""),
    ("Tríceps", "Press Francés", "", ""),
    ("Tríceps", "Press Francés", "Con Mancuernas", ""),
    ("Tríceps", "Press Francés", "En Hammer", ""),
    ("Tríceps", "Press Francés", "En Smith", ""),
    ("Tríceps", "Press Francés", "Peso Libre", ""),
]

# nombre viejo -> nombre nuevo (solo los que cambian)
NAME_MAP = {
    "Cruces - En Polea - Ascendente - Bilateral": "Cruces - En Polea - Ascendente",
    "Cruces - En Polea - Ascendente - Unilateral": "Cruces - En Polea - Ascendente Unilateral",
    "Cruces - En Polea - Descendente - Bilateral": "Cruces - En Polea - Descendente",
    "Cruces - En Polea - Descendente - Unilateral": "Cruces - En Polea - Descendente Unilateral",
    "Cruces - En Polea - Recto - Bilateral": "Cruces - En Polea - Recto",
    "Cruces - En Polea - Recto - Unilateral": "Cruces - En Polea - Recto Unilateral",
    "Curl Femoral - Acostado en Máquina": "Curl Femoral - En Máquina - Acostado",
    "Curl Femoral - Acostado en Máquina - Bilateral": "Curl Femoral - En Máquina - Acostado",
    "Curl Femoral - Acostado en Máquina - Unilateral": "Curl Femoral - En Máquina - Acostado Unilateral",
    "Curl Femoral - Sentado en Máquina": "Curl Femoral - En Máquina - Sentado",
    "Curl Femoral - Sentado en Máquina - Bilateral": "Curl Femoral - En Máquina - Sentado",
    "Curl Femoral - Sentado en Máquina - Unilateral": "Curl Femoral - En Máquina - Sentado Unilateral",
    "Curl de Bíceps - Bayesian": "Curl Bayesian",
    "Curl de Bíceps - Bayesian - Con Mancuernas (En Banco Inclinado)": "Curl Bayesian - Con Mancuernas - En Banco Inclinado",
    "Curl de Bíceps - Bayesian - Hammer - Bilateral": "Curl Bayesian - En Hammer",
    "Curl de Bíceps - Bayesian - Hammer - Unilateral": "Curl Bayesian - En Hammer - Unilateral",
    "Curl de Bíceps - Bayesian - Máquina - Bilateral": "Curl Bayesian - En Máquina",
    "Curl de Bíceps - Bayesian - Máquina - Unilateral": "Curl Bayesian - En Máquina - Unilateral",
    "Curl de Bíceps - Bayesian - Polea - Bilateral": "Curl Bayesian - En Polea",
    "Curl de Bíceps - Bayesian - Polea - Unilateral": "Curl Bayesian - En Polea - Unilateral",
    "Curl de Bíceps - Estándar": "Curl de Bíceps",
    "Curl de Bíceps - Estándar - Con Barra (Recta o EZ)": "Curl de Bíceps - Con Barra",
    "Curl de Bíceps - Estándar - Con Mancuernas": "Curl de Bíceps - Con Mancuernas",
    "Curl de Bíceps - Estándar - Con Mancuernas - Alternado": "Curl de Bíceps - Con Mancuernas - Alternado",
    "Curl de Bíceps - Estándar - Con Mancuernas - Bilateral": "Curl de Bíceps - Con Mancuernas",
    "Curl de Bíceps - Estándar - Con Mancuernas - Unilateral": "Curl de Bíceps - Con Mancuernas - Unilateral",
    "Curl de Bíceps - Estándar - En Polea": "Curl de Bíceps - En Polea",
    "Curl de Bíceps - Estándar - En Polea - Bilateral": "Curl de Bíceps - En Polea",
    "Curl de Bíceps - Estándar - En Polea - Unilateral": "Curl de Bíceps - En Polea - Unilateral",
    "Curl de Bíceps - Martillo": "Curl Martillo",
    "Curl de Bíceps - Martillo - Con Mancuernas": "Curl Martillo - Con Mancuernas",
    "Curl de Bíceps - Martillo - Con Mancuernas - Alternado": "Curl Martillo - Con Mancuernas - Alternado",
    "Curl de Bíceps - Martillo - Con Mancuernas - Bilateral": "Curl Martillo - Con Mancuernas",
    "Curl de Bíceps - Martillo - Con Mancuernas - Unilateral": "Curl Martillo - Con Mancuernas - Unilateral",
    "Curl de Bíceps - Martillo - En Polea": "Curl Martillo - En Polea",
    "Curl de Bíceps - Martillo - En Polea - Bilateral": "Curl Martillo - En Polea",
    "Curl de Bíceps - Martillo - En Polea - Unilateral": "Curl Martillo - En Polea - Unilateral",
    "Curl de Bíceps - Predicador": "Curl Predicador",
    "Curl de Bíceps - Predicador - Con Barra": "Curl Predicador - Con Barra",
    "Curl de Bíceps - Predicador - Con Mancuernas": "Curl Predicador - Con Mancuernas",
    "Curl de Bíceps - Predicador - Con Mancuernas - Bilateral": "Curl Predicador - Con Mancuernas",
    "Curl de Bíceps - Predicador - Con Mancuernas - Unilateral": "Curl Predicador - Con Mancuernas - Unilateral",
    "Curl de Bíceps - Predicador - En Hammer": "Curl Predicador - En Hammer",
    "Curl de Bíceps - Predicador - En Hammer - Bilateral": "Curl Predicador - En Hammer",
    "Curl de Bíceps - Predicador - En Hammer - Unilateral": "Curl Predicador - En Hammer - Unilateral",
    "Curl de Bíceps - Predicador - En Máquina": "Curl Predicador - En Máquina",
    "Curl de Bíceps - Predicador - En Máquina - Bilateral": "Curl Predicador - En Máquina",
    "Curl de Bíceps - Predicador - En Máquina - Unilateral": "Curl Predicador - En Máquina - Unilateral",
    "Curl de Bíceps - Predicador - En Polea": "Curl Predicador - En Polea",
    "Curl de Bíceps - Predicador - En Polea - Bilateral": "Curl Predicador - En Polea",
    "Curl de Bíceps - Predicador - En Polea - Unilateral": "Curl Predicador - En Polea - Unilateral",
    "Curl de Bíceps - Spider": "Curl Spider",
    "Curl de Bíceps - Spider - Con Barra": "Curl Spider - Con Barra",
    "Curl de Bíceps - Spider - Con Mancuernas": "Curl Spider - Con Mancuernas",
    "Curl de Bíceps - Spider - Con Mancuernas - Bilateral": "Curl Spider - Con Mancuernas",
    "Curl de Bíceps - Spider - Con Mancuernas - Unilateral": "Curl Spider - Con Mancuernas - Unilateral",
    "Dominadas - Agarre Neutro": "Dominadas - Con Peso Corporal - Agarre Neutro",
    "Dominadas - Agarre Prono (Pull-Up)": "Dominadas - Con Peso Corporal - Agarre Prono (Pull-Up)",
    "Dominadas - Agarre Supino (Chin-Up)": "Dominadas - Con Peso Corporal - Agarre Supino (Chin-Up)",
    "Elevaciones Frontales - Con Mancuernas Unilaterales": "Elevaciones Frontales - Con Mancuernas - Unilateral",
    "Elevaciones Frontales - Con Polea": "Elevaciones Frontales - En Polea",
    "Elevaciones Frontales - Con Polea Unilateral": "Elevaciones Frontales - En Polea - Unilateral",
    "Elevaciones Laterales - Con Mancuernas - De Pie - Bilateral": "Elevaciones Laterales - Con Mancuernas - De Pie",
    "Elevaciones Laterales - Con Mancuernas - De Pie - Unilateral": "Elevaciones Laterales - Con Mancuernas - De Pie Unilateral",
    "Elevaciones Laterales - Con Mancuernas - En Banco - Bilateral": "Elevaciones Laterales - Con Mancuernas - En Banco",
    "Elevaciones Laterales - Con Mancuernas - En Banco - Unilateral": "Elevaciones Laterales - Con Mancuernas - En Banco Unilateral",
    "Elevaciones Laterales - En Hammer - Bilateral": "Elevaciones Laterales - En Hammer",
    "Elevaciones Laterales - En Máquina - Bilateral": "Elevaciones Laterales - En Máquina",
    "Elevaciones Laterales - En Polea - Bilateral": "Elevaciones Laterales - En Polea",
    "Elevaciones de Piernas - Colgado en Barra": "Elevaciones de Piernas - En Barra Colgado",
    "Elevación de Talones - Con Rodilla Extendida": "Elevación de Talones",
    "Elevación de Talones - Con Rodilla Extendida - Con Barra": "Elevación de Talones - Con Barra",
    "Elevación de Talones - Con Rodilla Extendida - Con Barra Unilateral": "Elevación de Talones - Con Barra - Unilateral",
    "Elevación de Talones - Con Rodilla Extendida - Con Peso Corporal": "Elevación de Talones - Con Peso Corporal",
    "Elevación de Talones - Con Rodilla Extendida - Con Peso Corporal Unilateral": "Elevación de Talones - Con Peso Corporal - Unilateral",
    "Elevación de Talones - Con Rodilla Extendida - En Hack": "Elevación de Talones - En Hack",
    "Elevación de Talones - Con Rodilla Extendida - En Hack Unilateral": "Elevación de Talones - En Hack - Unilateral",
    "Elevación de Talones - Con Rodilla Extendida - En Prensa": "Elevación de Talones - En Prensa",
    "Elevación de Talones - Con Rodilla Extendida - En Prensa Unilateral": "Elevación de Talones - En Prensa - Unilateral",
    "Elevación de Talones - Con Rodilla Extendida - En Smith": "Elevación de Talones - En Smith",
    "Elevación de Talones - Con Rodilla Extendida - En Smith Unilateral": "Elevación de Talones - En Smith - Unilateral",
    "Elevación de Talones - Con Rodilla Flexionada (Sentado)": "Elevación de Talones Sentado",
    "Extensiones - Por Debajo de la Cabeza - Bilateral": "Extensiones - Por Debajo de la Cabeza",
    "Extensiones - Por Encima de la Cabeza - Katana - Bilateral": "Extensiones - Por Encima de la Cabeza - Katana",
    "Extensiones - Por Encima de la Cabeza - Katana - Unilateral": "Extensiones - Por Encima de la Cabeza - Katana Unilateral",
    "Extensión de Cuádriceps - Bilateral": "Extensión de Cuádriceps - En Máquina",
    "Extensión de Cuádriceps - En Hammer Unilateral": "Extensión de Cuádriceps - En Hammer - Unilateral",
    "Extensión de Cuádriceps - Unilateral": "Extensión de Cuádriceps - En Máquina - Unilateral",
    "Face Pull - En Polea con Cuerda": "Face Pull - En Polea - Con Cuerda",
    "Patada - Con Mancuerna - Bilateral": "Patada - Con Mancuernas",
    "Patada - Con Mancuerna - Unilateral": "Patada - Con Mancuernas - Unilateral",
    "Patada - En Polea - De Pie - Bilateral": "Patada - En Polea - De Pie",
    "Patada - En Polea - De Pie - Unilateral": "Patada - En Polea - De Pie Unilateral",
    "Patada - En Polea - Inclinado - Bilateral": "Patada - En Polea - Inclinado",
    "Patada - En Polea - Inclinado - Unilateral": "Patada - En Polea - Inclinado Unilateral",
    "Peso Muerto - Convencional": "Peso Muerto - Con Barra - Convencional",
    "Peso Muerto - Piernas Rígidas con Barra": "Peso Muerto Piernas Rígidas - Con Barra",
    "Peso Muerto - Piernas Rígidas con Mancuernas": "Peso Muerto Piernas Rígidas - Con Mancuernas",
    "Peso Muerto - Rumano": "Peso Muerto Rumano",
    "Peso Muerto - Rumano - Con Barra": "Peso Muerto Rumano - Con Barra",
    "Peso Muerto - Rumano - Con Mancuerna (Unilateral)": "Peso Muerto Rumano - Con Mancuernas - Unilateral",
    "Peso Muerto - Rumano - Con Mancuernas": "Peso Muerto Rumano - Con Mancuernas",
    "Peso Muerto - Sumo": "Peso Muerto - Con Barra - Sumo",
    "Plancha - Isométrica": "Plancha",
    "Prensa de Piernas - Bilateral": "Prensa de Piernas - En Máquina",
    "Prensa de Piernas - Unilateral": "Prensa de Piernas - En Máquina - Unilateral",
    "Press - Cerrado - En Smith": "Press Cerrado - En Smith",
    "Press - Cerrado - Hammer": "Press Cerrado - En Hammer",
    "Press - Cerrado - Libre": "Press Cerrado - Peso Libre",
    "Press - Declinado": "Press - Peso Libre - Declinado",
    "Press - Declinado - En Hammer": "Press - En Hammer - Declinado",
    "Press - Declinado - En Máquina": "Press - En Máquina - Declinado",
    "Press - Declinado - En Smith": "Press - En Smith - Declinado",
    "Press - Declinado - Libre": "Press - Peso Libre - Declinado",
    "Press - Francés - Con Mancuernas": "Press Francés - Con Mancuernas",
    "Press - Francés - En Smith": "Press Francés - En Smith",
    "Press - Francés - Hammer": "Press Francés - En Hammer",
    "Press - Francés - Libre": "Press Francés - Peso Libre",
    "Press - Inclinado": "Press - Peso Libre - Inclinado",
    "Press - Inclinado - En Hammer": "Press - En Hammer - Inclinado",
    "Press - Inclinado - En Máquina": "Press - En Máquina - Inclinado",
    "Press - Inclinado - En Smith": "Press - En Smith - Inclinado",
    "Press - Inclinado - Libre": "Press - Peso Libre - Inclinado",
    "Press - Plano": "Press - Peso Libre - Plano",
    "Press - Plano - En Hammer": "Press - En Hammer - Plano",
    "Press - Plano - En Máquina": "Press - En Máquina - Plano",
    "Press - Plano - En Smith": "Press - En Smith - Plano",
    "Press - Plano - Libre": "Press - Peso Libre - Plano",
    "Press Pallof - Con Polea": "Press Pallof - En Polea",
    "Puente de Glúteos - A Una Pierna": "Puente de Glúteos - Con Peso Corporal - Unilateral",
    "Pull Over - En Polea - De Pie - Bilateral": "Pull Over - En Polea - De Pie",
    "Pull Over - En Polea - De Pie - Unilateral": "Pull Over - En Polea - De Pie Unilateral",
    "Pull Over - En Polea - En Banco - Bilateral": "Pull Over - En Polea - En Banco",
    "Pull Over - En Polea - En Banco - Unilateral": "Pull Over - En Polea - En Banco Unilateral",
    "Remo en Barra T - Con Apoyo": "Remo en Barra T - Con Barra - Con Apoyo",
    "Remo en Barra T - Sin Apoyo": "Remo en Barra T - Con Barra - Sin Apoyo",
    "Sentadilla - En Máquina Hack": "Sentadilla - En Hack",
    "Sentadilla - En Máquina Smith": "Sentadilla - En Smith",
    "Sentadilla - En Máquina Smith - Frontal": "Sentadilla - En Smith - Frontal",
    "Sentadilla - En Máquina Smith - Trasera": "Sentadilla - En Smith - Trasera",
    "Vuelos Posteriores - En Máquina (Pec Deck Inverso)": "Vuelos Posteriores - En Máquina - Pec Deck Inverso",
    "Vuelos Posteriores - En Polea Unilateral": "Vuelos Posteriores - En Polea - Unilateral",
}


def _key(value: str) -> str:
    folded = unicodedata.normalize("NFD", value).encode("ascii", "ignore").decode("ascii")
    return folded.lower()


def _path_key(group: str, family: str, variation: str, subvariation: str) -> str:
    return "|".join(_key(p) for p in (group, family, variation, subvariation))


def _norm_name(name: str) -> str:
    # igual que coach_ai.training_core.naming.normalize_exercise_name
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def _rename_list(items: object, mapping: dict[str, str]) -> bool:
    changed = False
    if not isinstance(items, list):
        return False
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            new = mapping.get(item["name"])
            if new:
                item["name"] = new
                changed = True
    return changed


def _walk(node: object, mapping: dict[str, str]) -> bool:
    """Renombra los 'name' de toda lista bajo una clave 'exercises'."""
    changed = False
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "exercises":
                changed |= _rename_list(value, mapping)
            changed |= _walk(value, mapping)
    elif isinstance(node, list):
        for value in node:
            changed |= _walk(value, mapping)
    return changed


def _rewrite_json(
    conn, table: str, column: str, mapping: dict[str, str], top_list: bool, pk: str = "id"
) -> None:
    rows = conn.execute(
        sa.text(f"SELECT {pk}, {column} FROM {table} WHERE {column} IS NOT NULL")
    ).fetchall()
    for row_id, value in rows:
        data = json.loads(value) if isinstance(value, str) else value
        changed = _rename_list(data, mapping) if top_list else False
        changed |= _walk(data, mapping)
        if changed:
            conn.execute(
                sa.text(f"UPDATE {table} SET {column} = CAST(:v AS json) WHERE {pk} = :id"),
                {"v": json.dumps(data, ensure_ascii=False), "id": row_id},
            )


def upgrade() -> None:
    conn = op.get_bind()

    # 1) Catalogo global: reemplazar por el estandar.
    conn.execute(sa.text("DELETE FROM exercise_catalog WHERE owner_user_id IS NULL"))
    insert = sa.text(
        'INSERT INTO exercise_catalog (id, owner_user_id, path_key, "group", family, variation, '
        "subvariation, aliases, created_at_utc, updated_at_utc) "
        "VALUES (:id, NULL, :pk, :g, :f, :v, :s, NULL, now(), now())"
    )
    for group, family, variation, subvariation in NEW_ROWS:
        conn.execute(
            insert,
            {
                "id": uuid.uuid4(),
                "pk": _path_key(group, family, variation, subvariation),
                "g": group,
                "f": family,
                "v": variation or None,
                "s": subvariation or None,
            },
        )

    # 2) Nombres guardados como texto.
    _rewrite_json(conn, "sessions", "exercises", NAME_MAP, top_list=True)
    _rewrite_json(conn, "routine_stores", "store", NAME_MAP, top_list=False, pk="user_id")
    _rewrite_json(conn, "cycle_assignment_blocks", "routine_snapshot", NAME_MAP, top_list=False)
    _rewrite_json(conn, "micro_template_blocks", "routine_snapshot", NAME_MAP, top_list=False)

    for old, new in NAME_MAP.items():
        conn.execute(
            sa.text("UPDATE prediction_logs SET exercise_name = :n WHERE exercise_name = :o"),
            {"o": old, "n": new},
        )
        for table in ("routine_template_exercise_index", "coach_notes"):
            conn.execute(
                sa.text(
                    f"UPDATE {table} SET exercise_name_normalized = :n "
                    "WHERE exercise_name_normalized = :o"
                ),
                {"o": _norm_name(old), "n": _norm_name(new)},
            )


def downgrade() -> None:
    raise RuntimeError(
        "standardize_exercise_catalog no es reversible: varios nombres viejos se fusionaron."
    )
