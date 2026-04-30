import express from "express";
import type { AppConfig } from "../config.js";
import { asyncRoute } from "./errors.js";

import type { StripeBillingUseCases } from "../usecases/stripeBilling.js";
import type { StripeWebhookUseCase } from "../usecases/stripeWebhook.js";
import type { AdminUseCases } from "../usecases/admin.js";
import type { AiTextUseCases } from "../usecases/aiText.js";

export function buildRouter(deps: {
  config: AppConfig;
  stripeBilling: StripeBillingUseCases;
  stripeWebhook: StripeWebhookUseCase;
  admin: AdminUseCases;
  aiText: AiTextUseCases;
}) {
  const router = express.Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

  // Stripe webhook MUST receive raw body
  router.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    asyncRoute(async (req, res) => {
      const result = await deps.stripeWebhook.handle(req);
      res.status(result.status).send(result.body);
    }),
  );

  router.use(express.json({ limit: "2mb" }));

  router.post(
    "/api/stripe/create-checkout-session",
    asyncRoute(async (req, res) => {
      const out = await deps.stripeBilling.createCheckoutSession(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.post(
    "/api/stripe/create-portal-session",
    asyncRoute(async (req, res) => {
      const out = await deps.stripeBilling.createPortalSession(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.post(
    "/api/generate-field-text",
    asyncRoute(async (req, res) => {
      const out = await deps.aiText.generateFieldText(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.post(
    "/api/improve-text",
    asyncRoute(async (req, res) => {
      const out = await deps.aiText.improveText(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.get(
    "/api/admin/users",
    asyncRoute(async (req, res) => {
      const out = await deps.admin.listUsers(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.patch(
    "/api/admin/users/:userId",
    asyncRoute(async (req, res) => {
      const out = await deps.admin.patchUser(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.get(
    "/api/admin/billing/plans",
    asyncRoute(async (req, res) => {
      const out = await deps.admin.listBillingPlans(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.put(
    "/api/admin/billing/plans/:planKey",
    asyncRoute(async (req, res) => {
      const out = await deps.admin.upsertBillingPlan(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.get(
    "/api/admin/propostas",
    asyncRoute(async (req, res) => {
      const out = await deps.admin.listPropostas(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.patch(
    "/api/admin/propostas/:id",
    asyncRoute(async (req, res) => {
      const out = await deps.admin.updateProposta(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.get(
    "/api/admin/editais",
    asyncRoute(async (req, res) => {
      const out = await deps.admin.listEditais(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.patch(
    "/api/admin/editais/:id",
    asyncRoute(async (req, res) => {
      const out = await deps.admin.updateEdital(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.get(
    "/api/admin/redacoes",
    asyncRoute(async (req, res) => {
      const out = await deps.admin.listRedacoes(req);
      res.status(out.status).json(out.body);
    }),
  );

  router.patch(
    "/api/admin/redacoes/:id",
    asyncRoute(async (req, res) => {
      const out = await deps.admin.updateRedacaoStatus(req);
      res.status(out.status).json(out.body);
    }),
  );

  return router;
}

