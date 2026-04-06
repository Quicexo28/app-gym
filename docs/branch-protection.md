# Branch protection (Day 1)

Objetivo: impedir merges a `main` sin pasar el pipeline `release-gate`.

## Opcion UI (recomendada)

En GitHub -> Settings -> Branches -> Add branch protection rule:

- Branch name pattern: `main`
- Enable:
  - **Require a pull request before merging**
  - **Require status checks to pass before merging**
  - Required status checks:
    - `gate` (job del workflow `release-gate`)
  - **Require branches to be up to date before merging**
  - (Opcional) **Require conversation resolution before merging**
  - (Opcional) **Do not allow bypassing the above settings**

## Opcion CLI (si usas `gh` autenticado)

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/Quicexo28/app-gym/branches/main/protection \
  -f required_status_checks.strict=true \
  -F required_status_checks.contexts[]='gate' \
  -f enforce_admins=true \
  -f required_pull_request_reviews.dismiss_stale_reviews=true \
  -f required_pull_request_reviews.required_approving_review_count=1 \
  -f restrictions=
```

> Ajusta la regla según tu flujo (reviews mínimas, admins, etc.).
