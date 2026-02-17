# Utiliza una imagen ligera: las variantes “-slim” de Python reducen mucho el tamaño y superficie de ataque:contentReference[oaicite:0]{index=0}.
FROM python:3.11-slim

# Define el directorio de trabajo para las siguientes instrucciones:contentReference[oaicite:1]{index=1}.
WORKDIR /app

# Copia primero el archivo de configuración del proyecto.
# Esto permite aprovechar la caché de Docker si las dependencias no cambian:contentReference[oaicite:2]{index=2}.
COPY pyproject.toml .

# Instala las herramientas necesarias para compilar e instalar tu proyecto.
RUN pip install --no-cache-dir setuptools>=68 wheel:contentReference[oaicite:3]{index=3}

# Copia el código del proyecto.
COPY . .

# Instala tu aplicación como paquete de Python.
# Esto leerá las dependencias de pyproject.toml e instalará todo usando pip.
RUN pip install --no-cache-dir .

# Comando que se ejecutará al arrancar el contenedor:
# primero aplica las migraciones de base de datos con Alembic y luego
# inicia el servidor FastAPI con Uvicorn:contentReference[oaicite:4]{index=4}.
CMD ["bash", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]

