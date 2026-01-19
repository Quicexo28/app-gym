# Coach AI Engineer — Boilerplate (FastAPI + pytest + CI)

This repository is a **technical scaffold** for a decision-support training analytics platform.
It intentionally avoids "auto-coaching" behavior: the system **suggests scenarios** with uncertainty,
and the **human** remains the authority.

## Quickstart (local)

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -U pip
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Open: http://127.0.0.1:8000/docs

## Tests

```bash
pytest -q
```

## Lint

```bash
ruff check .
ruff format .
```

## Structure

- `app/` FastAPI application (API surface)
- `coach_ai/` Domain modules (training_core, trends, latent states, suggestions)
- `tests/` Unit tests

## Notes

- No database is configured in Phase 0. Add Postgres + ORM in Phase 1 (schema + validation).
- CI runs tests + ruff on every push/PR.
