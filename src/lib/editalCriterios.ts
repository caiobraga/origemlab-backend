/**
 * Critérios de seleção de editais da fundação de apoio (filtro padrão do match projeto × editais):
 * - eliminatórios: duração < 2 anos, valor por projeto < R$ 2 mi, execução via TransfereGov,
 *   exige construção civil (reforma pode), execução integral pela Lei 14.133;
 * - recomendações: até 3 aportes em projetos < R$ 3 mi; preferir sem CLT;
 * - preferências: pesquisa e inovação; Finep (experiência da equipe).
 * Dado não informado nunca exclui: vira um alerta "verificar".
 */

export const CRITERIOS_SELECAO = {
  duracaoMinMeses: 24,
  valorMin: 2_000_000,
  valorLimiteParcelas: 3_000_000,
  maxParcelas: 3,
} as const;

/** Textos curtos para a UI explicar o filtro. */
export const CRITERIOS_SELECAO_RESUMO = [
  "Execução mínima de 2 anos",
  "Valor por projeto a partir de R$ 2 milhões",
  "Sem execução via TransfereGov",
  "Sem construção civil (reformas podem)",
  "Sem execução integral pela Lei 14.133",
  "Até 3 aportes em projetos abaixo de R$ 3 milhões",
  "Preferência: sem CLT, pesquisa e inovação, Finep",
];

export type PerfilExecucao = {
  prazo_execucao_meses?: number | null;
  valor_global_projeto?: number | null;
  num_parcelas?: number | null;
  transferegov?: boolean | null;
  exige_obra?: boolean | null;
  clt?: boolean | null;
  lei_14133_integral?: boolean | null;
  pd_inovacao?: boolean | null;
};

export type AvaliacaoCriterios =
  | { excluido: true; motivo: string }
  | { excluido: false; pontos: number; motivos: string[]; alertas: string[] };

function parseJsonObject(v: unknown): Record<string, any> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, any>;
  if (typeof v !== "string" || !v.trim().startsWith("{")) return null;
  try {
    const o = JSON.parse(v);
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Valor máximo por projeto, em reais. `teto` = limite superior conhecido quando só se sabe
 * o orçamento total da chamada (o projeto não passa do total).
 */
export function valorPorProjeto(edital: { valor_projeto?: unknown; perfil_execucao?: unknown }): {
  valor: number | null;
  teto: number | null;
} {
  const vp = parseJsonObject(edital.valor_projeto);
  const perfil = parseJsonObject(edital.perfil_execucao) as PerfilExecucao | null;
  const max = num(vp?.por_projeto_max);
  if (max) return { valor: max, teto: max };
  const total = num(vp?.total_programa);
  const qtd = num(vp?.qtd_projetos);
  if (total && qtd) return { valor: Math.round(total / qtd), teto: total };
  const doPerfil = num(perfil?.valor_global_projeto);
  if (doPerfil) return { valor: doPerfil, teto: total ? Math.min(total, doPerfil) : doPerfil };
  return { valor: null, teto: total };
}

const fmtMi = (v: number) =>
  `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;

export function avaliarCriteriosSelecao(edital: {
  fonte?: string | null;
  orgao?: string | null;
  valor_projeto?: unknown;
  perfil_execucao?: unknown;
}): AvaliacaoCriterios {
  const c = CRITERIOS_SELECAO;
  const p = (parseJsonObject(edital.perfil_execucao) || {}) as PerfilExecucao;
  const motivos: string[] = [];
  const alertas: string[] = [];
  let pontos = 0;

  // Eliminatórios
  if (p.transferegov === true) return { excluido: true, motivo: "Execução via TransfereGov" };
  if (p.exige_obra === true) return { excluido: true, motivo: "Exige construção civil" };
  if (p.lei_14133_integral === true) return { excluido: true, motivo: "Execução integral pela Lei 14.133" };

  const meses = num(p.prazo_execucao_meses);
  if (meses != null && meses < c.duracaoMinMeses) {
    return { excluido: true, motivo: `Execução de ${meses} meses (mínimo 24)` };
  }
  if (meses != null) motivos.push(`Execução de até ${meses} meses`);
  else alertas.push("Verificar duração");

  const { valor, teto } = valorPorProjeto(edital);
  const valorRef = valor ?? teto;
  if (valor != null && valor < c.valorMin) {
    return { excluido: true, motivo: `Até ${fmtMi(valor)} por projeto (mínimo R$ 2 mi)` };
  }
  if (valor == null && teto != null && teto < c.valorMin) {
    return { excluido: true, motivo: `Chamada inteira de ${fmtMi(teto)} (mínimo R$ 2 mi)` };
  }
  if (valor != null) motivos.push(`Até ${fmtMi(valor)} por projeto`);
  else alertas.push("Verificar valor por projeto");

  // Recomendações (não excluem, pesam no ranking)
  const parcelas = num(p.num_parcelas);
  if (parcelas != null && parcelas > c.maxParcelas && (valorRef == null || valorRef < c.valorLimiteParcelas)) {
    pontos -= 10;
    alertas.push(`${parcelas} aportes (recomendado até ${c.maxParcelas})`);
  }

  if (p.clt === true) {
    pontos -= 10;
    alertas.push("Prevê CLT: aporte inicial deve cobrir todo o contrato");
  } else if (p.clt === false) {
    pontos += 5;
    motivos.push("Sem CLT");
  }

  // Preferências
  if (p.pd_inovacao === true) {
    pontos += 10;
    motivos.push("Pesquisa e inovação");
  } else if (p.pd_inovacao === false) {
    pontos -= 15;
    alertas.push("Objeto fora de pesquisa e inovação");
  }

  const fonte = `${edital.fonte || ""} ${edital.orgao || ""}`.toLowerCase();
  if (/\bfinep\b/.test(fonte)) {
    pontos += 10;
    motivos.push("Finep");
  }

  return { excluido: false, pontos, motivos, alertas };
}
