/**
 * Extrai valores monetários em BRL de `valor_projeto` / `valor` para estimar potencial de arrecadação.
 */

import {
  aggregateValorEnvelopeBRL,
  extractBRLAmountsFromValue,
  extractValorEnvelopeBRL,
} from "./editalValorExtract.js";

export type ArrecadacaoCatalogoStats = {
  totalBRL: number;
  editaisComValor: number;
  editaisConsiderados: number;
};

export { extractValorEnvelopeBRL as extractValorDisponivelBRL };

export function computeArrecadacaoCatalogo(
  editais: ReadonlyArray<{ valor_projeto?: unknown; valor?: unknown }>,
): ArrecadacaoCatalogoStats {
  let totalBRL = 0;
  let editaisComValor = 0;

  for (const edital of editais) {
    const valor = extractValorEnvelopeBRL(edital.valor_projeto, edital.valor);
    if (valor == null) continue;
    editaisComValor += 1;
    totalBRL += valor;
  }

  return {
    totalBRL,
    editaisComValor,
    editaisConsiderados: editais.length,
  };
}

export function formatArrecadacaoResumo(totalBRL: number): { main: string; detail?: string } {
  if (!Number.isFinite(totalBRL) || totalBRL <= 0) {
    return { main: "—" };
  }

  const full = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(totalBRL);

  if (totalBRL >= 10_000_000) {
    const compact = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(totalBRL);
    return { main: compact, detail: full };
  }

  return { main: full };
}

// Re-export for testes / uso externo
export { aggregateValorEnvelopeBRL, extractBRLAmountsFromValue };
