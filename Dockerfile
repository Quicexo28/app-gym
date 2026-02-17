FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip "setuptools>=68" wheel

COPY pyproject.toml README.md ./
COPY alembic.ini ./alembic.ini
COPY migrations ./migrations
COPY src ./src

RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/src --reload-dir /app/migrations"]
