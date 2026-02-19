#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

REPO_DIR="${1:-/opt/coach-ai-engineer-boilerplate}"
SERVICE_PATH="/etc/systemd/system/coach-ai.service"

if [[ ! -f "${REPO_DIR}/docker-compose.prod.yml" ]]; then
  echo "docker-compose.prod.yml not found in ${REPO_DIR}" >&2
  exit 1
fi

if [[ ! -f "${REPO_DIR}/.env.prod" ]]; then
  echo ".env.prod not found in ${REPO_DIR}" >&2
  exit 1
fi

cat > "${SERVICE_PATH}" <<EOF
[Unit]
Description=Coach AI production stack
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${REPO_DIR}
ExecStart=/usr/bin/docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose --env-file .env.prod -f docker-compose.prod.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now coach-ai.service
systemctl status --no-pager coach-ai.service
