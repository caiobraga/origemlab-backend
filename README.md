# origemlab-backend

Backend separado (Express) para rodar fora da Vercel.

## Rodar local

```bash
cd origemlab-backend
npm i
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
AISELFIE_STRIPE_SECRET_KEY=... AISELFIE_STRIPE_WEBHOOK_SECRET=... \
APP_BASE_URL=http://localhost:5173 \
npm run dev
``` 
 

## Endpoints

- `GET /health`
- `POST /api/stripe/create-checkout-session`
- `POST /api/stripe/create-portal-session`
- `POST /api/stripe/webhook` (precisa de raw body)
- `GET /api/admin/users`
- `PATCH /api/admin/users/:userId`
- `GET /api/admin/billing/plans`
- `PUT /api/admin/billing/plans/:planKey`

## Deploy (GitHub Actions -> AWS App Runner)

Este repo já inclui `.github/workflows/deploy.yml`.

No GitHub (Settings → Variables), defina:

- `AWS_REGION`
- `AWS_ROLE_ARN` (IAM Role com OIDC para este repo)
- `ECR_REPOSITORY` (ex: `origemlab-backend`)
- `APPRUNNER_SERVICE_ARN`

No frontend, use `VITE_API_BASE_URL=https://<dominio-do-backend>`.

