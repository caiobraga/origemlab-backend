import type { Request } from "express";
import type { AppConfig } from "../config.js";
import type { SupabaseGateway } from "../infra/gateways.js";
import { buildProposalFieldAiUseCases, type ProposalFieldAiUseCases } from "./proposalFieldAi.js";

export type AiTextUseCases = ProposalFieldAiUseCases;

export function buildAiTextUseCases(deps: {
  config: AppConfig;
  supabase: SupabaseGateway;
  auth: AuthUseCases;
}): AiTextUseCases {
  return buildProposalFieldAiUseCases(deps);
}

export type { Request };
