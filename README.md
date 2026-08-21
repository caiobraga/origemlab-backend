# origemlab-backend

Backend separado (Express) para rodar fora da Vercel.

## Rodar local

```bash
# From repo root (recommended):
pnpm install
cp .env.example .env.local   # fill SUPABASE_* + OPENROUTER_API_KEY
pnpm dev:api                 # API on :8081 (matches Vite proxy)

# Or from this folder:
cp .env.example .env.local
pnpm dev:local               # PORT=8081
```

From the **origemlab** root, `pnpm dev` starts front + API together.

Variáveis: ver [`.env.example`](.env.example). Mínimo: `SUPABASE_*` + `OPENROUTER_API_KEY` (com `AI_PROVIDER=openrouter`, default). Alternativa local: `AI_PROVIDER=ollama` + `OLLAMA_BASE_URL`. 
 

## Pesquisa web (embasamento de propostas)

Para o fluxo **Embasar com referências** nos campos da proposta, configure pelo menos uma API de busca:

- `TAVILY_API_KEY` — [Tavily](https://tavily.com/) (recomendado), ou
- `SERPER_API_KEY` — [Serper](https://serper.dev/)

Opcional: `WEB_SEARCH_MAX_QUERIES` (padrão 4), `WEB_SEARCH_MAX_RESULTS` (padrão 5).

O pipeline usa o LLM configurado (`AI_PROVIDER=openrouter` por padrão, ou Ollama) para identificar afirmações, gerar consultas, e reescrever o texto com as fontes encontradas.

**Produção:** `OPENROUTER_API_KEY` + `AI_PROVIDER=openrouter` (secret/vars GitHub → JSON env no S3 do EB). Emergência: `AI_PROVIDER=ollama` + `OLLAMA_BASE_URL`.

### Produção (Elastic Beanstalk)

No GitHub do backend (Settings → Secrets and variables → Actions):

- **Secret:** `OPENROUTER_API_KEY`, `TAVILY_API_KEY` (ou `SERPER_API_KEY` como alternativa)
- **Variables:** `AI_PROVIDER=openrouter`, `OPENROUTER_CHAT_MODEL`, `OPENROUTER_EMBED_MODEL`, `EMBED_DIMENSIONS=1024`
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

**Variables:** `AWS_REGION`, `AWS_ROLE_ARN`, `EB_APPLICATION_NAME`, `EB_ENVIRONMENT_NAME`, `EB_DEPLOY_BUCKET`, `AI_PROVIDER`, `OPENROUTER_*`, `EMBED_DIMENSIONS`, `OLLAMA_*` (só se ollama), `APP_BASE_URL`, `CORS_ALLOW_ORIGIN`, etc.

**Secrets:** `SUPABASE_*`, Stripe, **`OPENROUTER_API_KEY`**, **`TAVILY_API_KEY`** (pesquisa web nas propostas).

No frontend: `VITE_API_BASE_URL=https://<dominio-da-api>`.

