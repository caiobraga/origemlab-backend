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
 

## Pesquisa web (embasamento de propostas)

Para o fluxo **Embasar com referências** nos campos da proposta, configure pelo menos uma API de busca:

- `TAVILY_API_KEY` — [Tavily](https://tavily.com/) (recomendado), ou
- `SERPER_API_KEY` — [Serper](https://serper.dev/)

Opcional: `WEB_SEARCH_MAX_QUERIES` (padrão 4), `WEB_SEARCH_MAX_RESULTS` (padrão 5).

O pipeline usa Ollama (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`) para identificar afirmações, gerar consultas, e reescrever o texto com as fontes encontradas.

**Produção:** `OLLAMA_BASE_URL=http://origemlab-ollama-nlb-312422980eebe2d0.elb.us-east-1.amazonaws.com:11434` (variável GitHub + JSON env no S3 do EB).

### Produção (Elastic Beanstalk)

No GitHub do backend (Settings → Secrets and variables → Actions):

- **Secret:** `TAVILY_API_KEY` (ou `SERPER_API_KEY` como alternativa)
- **Variables opcionais:** `WEB_SEARCH_MAX_QUERIES`, `WEB_SEARCH_MAX_RESULTS`

O workflow `deploy.yml` inclui estas chaves no JSON enviado ao S3 (`elasticbeanstalk-env.json`); o EB carrega-as em runtime via `APP_ENV_S3_*`.

## Endpoints

- `GET /health`
- `POST /api/generate-field-text`
- `POST /api/improve-text`
- `POST /api/analyze-field`
- `POST /api/ground-field-with-references` — pesquisa web + reescrita com referências
- `POST /api/stripe/create-checkout-session`
- `POST /api/stripe/create-portal-session`
- `POST /api/stripe/webhook` (precisa de raw body)
- `GET /api/admin/users`
- `PATCH /api/admin/users/:userId`
- `GET /api/admin/billing/plans`
- `PUT /api/admin/billing/plans/:planKey`

## Deploy (GitHub Actions → Elastic Beanstalk)

Workflow: `.github/workflows/deploy.yml` (push em `main` ou manual).

**Variables:** `AWS_REGION`, `AWS_ROLE_ARN`, `EB_APPLICATION_NAME`, `EB_ENVIRONMENT_NAME`, `EB_DEPLOY_BUCKET`, `OLLAMA_*`, `APP_BASE_URL`, `CORS_ALLOW_ORIGIN`, etc.

**Secrets:** `SUPABASE_*`, Stripe, **`TAVILY_API_KEY`** (pesquisa web nas propostas).

No frontend: `VITE_API_BASE_URL=https://<dominio-da-api>`.

