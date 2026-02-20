#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_DIR="${REPO_DIR:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.prod}"

cd "${REPO_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Create it from .env.prod.example first." >&2
  exit 1
fi

echo "==> Building API and Web images"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build api web

echo "==> Starting database"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d db

echo "==> Running migrations"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm migrate

echo "==> Starting API and Web"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d api web

echo "==> Stack status"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
