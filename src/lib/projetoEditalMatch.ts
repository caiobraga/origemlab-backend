/**
 * Match projeto × editais: abrangência geográfica (UF), filtros de elegibilidade
 * e relevância temática (TF-IDF sobre o catálogo de editais carregado).
 */

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
export type Uf = (typeof UFS)[number];
const UF_SET = new Set<string>(UFS);

const AMAZONIA_LEGAL: Uf[] = ["AC", "AM", "AP", "MA", "MT", "PA", "RO", "RR", "TO"];

/** Fontes (scrapers) de agências estaduais: o edital só financia proponentes da UF. */
const FONTE_UF: Record<string, Uf> = {
  fapac: "AC",
  fapeal: "AL",
  fapeap: "AP",
  fapeam: "AM",
  fapesb: "BA",
  funcap: "CE",
  fapdf: "DF",
  fapes: "ES",
  sigfapes: "ES",
  fapeg: "GO",
  fapema: "MA",
  fapemat: "MT",
  fundect: "MS",
  fapemig: "MG",
  fapespa: "PA",
  fapesq: "PB",
  "fundacao-araucaria": "PR",
  araucaria: "PR",
  facepe: "PE",
  fapepi: "PI",
  faperj: "RJ",
  fapern: "RN",
  fapergs: "RS",
  fapero: "RO",
  faperr: "RR",
  fapesc: "SC",
  fapesp: "SP",
  fapitec: "SE",
  fapt: "TO",
};

/** Fontes federais: abrangência nacional (o endereço da sede não restringe). */
const FONTES_NACIONAIS = new Set(["cnpq", "finep", "bndes", "capes", "embrapii", "mcti", "confap"]);

/** Nomes de estado normalizados (sem acento, minúsculos). Ordem importa: mais longos primeiro. */
const UF_NOMES: Array<[RegExp, Uf[]]> = [
  [/\bamazonia legal\b/, AMAZONIA_LEGAL],
  [/\bespirito santo\b|\bcapixaba/, ["ES"]],
  [/\brio grande do sul\b|\bgaucho/, ["RS"]],
  [/\brio grande do norte\b|\bpotiguar/, ["RN"]],
  [/\bmato grosso do sul\b|\bsul-mato-grossense/, ["MS"]],
  [/\bmato grosso\b(?! do sul)/, ["MT"]],
  [/\b(estado do )?rio de janeiro\b|\bfluminense\b/, ["RJ"]],
  [/\bsao paulo\b|\bpaulista\b/, ["SP"]],
  [/\bminas gerais\b|\bmineir[oa]s?\b/, ["MG"]],
  [/\bsanta catarina\b|\bsanta caterina\b|\bcatarinense/, ["SC"]],
  [/\bparana\b|\bparanaense/, ["PR"]],
  [/\bestado do para\b|\bparaense/, ["PA"]],
  [/\bparaiba\b|\bparaibano/, ["PB"]],
  [/\bpernambuco\b|\bpernambucano/, ["PE"]],
  [/\bbahia\b|\bbaian[oa]/, ["BA"]],
  [/\bceara\b|\bcearense/, ["CE"]],
  [/\balagoas\b|\balagoano/, ["AL"]],
  [/\bsergipe\b|\bsergipano/, ["SE"]],
  [/\bpiaui\b|\bpiauiense/, ["PI"]],
  [/\bmaranhao\b|\bmaranhense/, ["MA"]],
  [/\btocantins\b/, ["TO"]],
  [/\bgoias\b|\bgoiano/, ["GO"]],
  [/\bdistrito federal\b|\bbrasilia\b/, ["DF"]],
  [/\bestado do acre\b|\bacreano/, ["AC"]],
  [/\bamapa\b|\bamapaense/, ["AP"]],
  [/\bestado do amazonas\b|\bamazonas\b|\bamazonense/, ["AM"]],
  [/\broraima\b/, ["RR"]],
  [/\brondonia\b/, ["RO"]],
];

const NACIONAL_RE = /\b(brasil|nacional|todo o pais|territorio nacional|26 estados|todos os estados)\b/;

export function normalizeMatchText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function ufsFromSiglas(raw: string): Uf[] {
  const out = new Set<Uf>();
  const patterns = [
    /\bSENAI[\s/-]*([A-Z]{2})\b/g,
    /\(([A-Z]{2})\)/g,
    /[/–-]\s?([A-Z]{2})\b(?![/-]\d)/g,
  ];
  for (const re of patterns) {
    for (const m of raw.matchAll(re)) {
      if (UF_SET.has(m[1])) out.add(m[1] as Uf);
    }
  }
  return [...out];
}

function ufsFromTexto(raw: string): Uf[] {
  const norm = normalizeMatchText(raw);
  const out = new Set<Uf>(ufsFromSiglas(raw));
  for (const [re, ufs] of UF_NOMES) {
    if (re.test(norm)) ufs.forEach((u) => out.add(u));
  }
  return [...out];
}

export type EditalAbrangencia = {
  /** null = nacional (sem restrição de UF). */
  ufs: Uf[] | null;
  origem: "fonte" | "texto" | "padrao";
};

/**
 * Abrangência do edital: FAP estadual pela `fonte`; agências federais = nacional;
 * agregadores (SENAI, Capta, Rota do Fomento…) pelo título/órgão e depois `localizacao`.
 */
export function inferEditalAbrangencia(edital: {
  fonte?: string | null;
  orgao?: string | null;
  titulo?: string | null;
  localizacao?: string | null;
}): EditalAbrangencia {
  const fonte = normalizeMatchText(edital.fonte).trim();
  if (FONTE_UF[fonte]) return { ufs: [FONTE_UF[fonte]], origem: "fonte" };
  if (FONTES_NACIONAIS.has(fonte)) return { ufs: null, origem: "fonte" };

  const orgao = normalizeMatchText(edital.orgao).replace(/[^a-z]/g, "");
  // Órgão exato ("FAPES") ou com UF colada ("FAPITEC/SE" → "fapitecse").
  for (const [sigla, uf] of Object.entries(FONTE_UF)) {
    if (orgao === sigla || orgao === `${sigla}${uf.toLowerCase()}`) return { ufs: [uf], origem: "fonte" };
  }

  // Título antes do órgão: em agregadores o `orgao` às vezes vem de outro edital da listagem.
  for (const campo of [edital.titulo, edital.orgao]) {
    const ufs = ufsFromTexto(String(campo ?? ""));
    if (ufs.length) return { ufs, origem: "texto" };
  }

  const loc = String(edital.localizacao ?? "");
  if (loc && !NACIONAL_RE.test(normalizeMatchText(loc))) {
    const daLocalizacao = ufsFromTexto(loc);
    if (daLocalizacao.length) return { ufs: daLocalizacao, origem: "texto" };
  }
  return { ufs: null, origem: "padrao" };
}

/** Lista de UFs do projeto (coluna `abrangencia_ufs`); vazio = nacional/sem restrição. */
export function normalizeProjetoUfs(v: unknown): Uf[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\s]+/) : [];
  const out = new Set<Uf>();
  for (const item of arr) {
    const s = String(item ?? "").trim().toUpperCase();
    if (UF_SET.has(s)) out.add(s as Uf);
  }
  return UFS.filter((u) => out.has(u));
}

// --- Relevância temática -------------------------------------------------

const STOPWORDS = new Set(
  `a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra com sem sob sobre
  entre ate apos ante e ou mas que se ao aos como mais menos muito muita muitos muitas seu sua seus suas este esta
  estes estas esse essa esses essas isso isto aquele aquela ser sao foi sera serao ter tem terao ha nao sim ja tambem
  quando onde qual quais cada todo toda todos todas outro outra outros outras mesmo mesma bem assim forma partir
  meio atraves deve devem pode podem sendo sido sera visa visando visam objetivo objetivos geral especificos
  projeto projetos proposta propostas edital editais chamada chamadas programa programas apoio apoiar
  pesquisa pesquisas pesquisador pesquisadores desenvolvimento desenvolver inovacao inovacoes inovador inovadora
  tecnologia tecnologias tecnologica tecnologico tecnologicas tecnologicos solucao solucoes recurso
  financiamento fomento valor valores prazo inscricao inscricoes submissao selecao publica publico processo
  estado estadual federal nacional brasil instituicao instituicoes ensino superior empresa empresas area areas
  ciencia ciencias cientifica cientifico cientificas cientificos rede atividades atividade acoes acao
  resultado resultados meta metas etapa etapas ano anos mes meses dia dias periodo data numero nº
  brasil brasileiro brasileira brasileiros regiao regional municipio municipios espirito santo capixaba capixabas
  bahia ceara pernambuco goias minas gerais catarina janeiro paulo parana sergipe alagoas piaui maranhao tocantins
  rondonia roraima amapa acre paraiba fluminense paulista mineiro gaucho
  respostas abordagens abordagem busca junto potencializar impulsionar iniciativa iniciativas desafio desafios
  impacto impactos relevante relevantes concentra visa possibilitar desenvolvam incluem base setor bndes
  denominada denominado tres quatro cinco primeira segunda novo nova novos novas grande maior principal
  the and for with of to in on`.split(/\s+/).filter(Boolean),
);

function stem(token: string): string {
  // Stemming simples por prefixo: aproxima flexões (hidrico/hidricos/hidrica).
  return token.length > 7 ? token.slice(0, 7) : token.replace(/s$/, "");
}

export function matchTokens(text: unknown): string[] {
  return normalizeMatchText(text)
    .split(/[^a-z0-9]+/)
    // gerúndios ("evitando", "protegendo") são verbos genéricos, não tema
    .filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !STOPWORDS.has(t) && !/(ando|endo|indo)$/.test(t))
    .map(stem);
}

type Vec = Map<string, number>;

function addWeighted(vec: Vec, text: unknown, weight: number) {
  for (const t of matchTokens(text)) vec.set(t, (vec.get(t) || 0) + weight);
}

export function editalTermVector(edital: any): Vec {
  const vec: Vec = new Map();
  addWeighted(vec, edital.titulo, 3);
  addWeighted(vec, edital.area, 2);
  addWeighted(vec, edital.descricao, 1);
  addWeighted(vec, edital.sobre_programa, 1);
  addWeighted(vec, String(edital.criterios_elegibilidade ?? "").slice(0, 3000), 0.5);
  return vec;
}

export function projetoTermVector(projeto: any): Vec {
  const c = projeto?.conteudo && typeof projeto.conteudo === "object" ? projeto.conteudo : {};
  const kws = [
    ...(Array.isArray(c.palavras_chave) ? c.palavras_chave : []),
    ...(Array.isArray(c.palavras_chave_ingles) ? c.palavras_chave_ingles : []),
  ];
  const vec: Vec = new Map();
  addWeighted(vec, projeto?.titulo, 3);
  addWeighted(vec, kws.join(" "), 3);
  addWeighted(vec, projeto?.resumo, 1.5);
  addWeighted(vec, projeto?.objetivos, 1);
  addWeighted(vec, c.objetivo_geral, 1.5);
  addWeighted(vec, c.resumo_executivo, 1);
  addWeighted(vec, c.caracterizacao_problema, 0.7);
  addWeighted(vec, c.objetivos_especificos, 0.7);
  addWeighted(vec, c.resultados_esperados, 0.5);
  addWeighted(vec, c.impactos, 0.5);
  addWeighted(vec, c.relevancia_setor_produtivo, 0.5);
  addWeighted(vec, c.origem?.descricao, 0.5);
  return vec;
}

export type MatchCorpus = { idf: Map<string, number>; vectors: Map<any, Vec> };

export function buildMatchCorpus(editais: any[]): MatchCorpus {
  const df = new Map<string, number>();
  const vectors = new Map<any, Vec>();
  for (const e of editais) {
    const v = editalTermVector(e);
    vectors.set(e, v);
    for (const t of v.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const n = Math.max(1, editais.length);
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(1 + n / d));
  return { idf, vectors };
}

function tfidf(vec: Vec, idf: Map<string, number>, fallbackIdf: number): Vec {
  const out: Vec = new Map();
  for (const [t, tf] of vec) out.set(t, (1 + Math.log(tf)) * (idf.get(t) ?? fallbackIdf));
  return out;
}

function cosine(a: Vec, b: Vec): { sim: number; shared: Array<[string, number]> } {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const shared: Array<[string, number]> = [];
  for (const [t, w] of a) {
    na += w * w;
    const wb = b.get(t);
    if (wb) {
      dot += w * wb;
      shared.push([t, w * wb]);
    }
  }
  for (const w of b.values()) nb += w * w;
  if (!dot) return { sim: 0, shared };
  shared.sort((x, y) => y[1] - x[1]);
  return { sim: dot / Math.sqrt(na * nb), shared };
}

/** Recupera uma palavra legível do texto do edital para cada stem em comum. */
function displayTerms(stems: string[], edital: any): string[] {
  const raw = [edital.titulo, edital.area, edital.descricao, edital.sobre_programa].join(" ");
  const words = raw.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
  const out: string[] = [];
  for (const s of stems) {
    const w = words.find((x) => stem(normalizeMatchText(x)) === s);
    if (w) out.push(w.toLowerCase());
  }
  return [...new Set(out)];
}

// --- Score final ---------------------------------------------------------

const AREA_TERMS: Record<string, string[]> = {
  tech: ["software", "digital", "robotica", "inteligencia artificial", "computacao", "dados"],
  health: ["saude", "medicina", "biotecnologia", "farmac", "hospital"],
  agro: ["agro", "agricultura", "rural", "agricola", "alimentos", "pecuaria"],
  energy: ["energia", "energetic", "renovavel", "bioenergia", "eletric"],
  bio: ["biotecnologia", "biologia", "genetica", "biodiversidade"],
  environment: ["ambiental", "meio ambiente", "clima", "hidric", "saneamento", "sustentab"],
  education: ["educacao", "ensino", "escola", "formacao"],
  social: ["social", "comunidade", "vulnerab", "inclusao"],
};

export type ProjetoEditalMatch = {
  score: number;
  motivos: string[];
  /** Temas em comum (palavras do edital) — base do "por que apareceu". */
  termos: string[];
  /** UFs onde o edital financia; null = nacional. */
  abrangencia: Uf[] | null;
};

export type MatchExclusao = { excluido: true; motivo: string };

/** Similaridade mínima (cosseno TF-IDF) para considerar o edital temático. */
export const MIN_SIMILARIDADE = 0.08;
/** Score final mínimo para aparecer na lista. */
export const MIN_SCORE = 30;

export function scoreProjetoEdital(
  projeto: any,
  edital: any,
  corpus: MatchCorpus,
  opts: { deadline: Date | null; today?: Date; projetoVec?: Vec },
): ProjetoEditalMatch | MatchExclusao {
  const motivos: string[] = [];

  // 1) Região
  const projetoUfs = normalizeProjetoUfs(projeto?.abrangencia_ufs);
  const abr = inferEditalAbrangencia(edital);
  if (projetoUfs.length && abr.ufs) {
    const inter = abr.ufs.filter((u) => projetoUfs.includes(u));
    if (!inter.length) return { excluido: true, motivo: `Financia apenas em ${abr.ufs.join(", ")}` };
    motivos.push(`Financia em ${inter.join(", ")}`);
  } else if (projetoUfs.length && !abr.ufs) {
    motivos.push("Edital de abrangência nacional");
  }

  // 2) Prazo
  const today = opts.today ? new Date(opts.today) : new Date();
  today.setHours(0, 0, 0, 0);
  let prazoAberto = false;
  if (opts.deadline) {
    const end = new Date(opts.deadline);
    end.setHours(23, 59, 59, 999);
    if (end.getTime() < today.getTime()) return { excluido: true, motivo: "Prazo encerrado" };
    prazoAberto = true;
  }

  // 3) Público
  const publico = String(projeto?.publico_alvo || "ambos");
  let score = 0;
  if (publico === "pesquisador") {
    if (edital.is_researcher === false && edital.is_company === true) {
      return { excluido: true, motivo: "Edital voltado a empresas" };
    }
    if (edital.is_researcher === true) {
      score += 10;
      motivos.push("Aceita pesquisadores/ICTs");
    }
  } else if (publico === "empresa") {
    if (edital.is_company === false && edital.is_researcher === true) {
      return { excluido: true, motivo: "Edital voltado a pesquisadores" };
    }
    if (edital.is_company === true) {
      score += 10;
      motivos.push("Aceita empresas");
    }
  } else if (edital.is_researcher === true || edital.is_company === true) {
    score += 5;
  }

  // 4) Tema
  const fallbackIdf = Math.log(1 + corpus.vectors.size);
  const pv = tfidf(opts.projetoVec ?? projetoTermVector(projeto), corpus.idf, fallbackIdf);
  const ev = tfidf(corpus.vectors.get(edital) ?? editalTermVector(edital), corpus.idf, fallbackIdf);
  const { sim, shared } = cosine(pv, ev);

  const areaTerms = AREA_TERMS[String(projeto?.area || "")] || [];
  const editalHay = normalizeMatchText([edital.titulo, edital.area, edital.descricao].join(" "));
  const areaHit = areaTerms.some((t) => editalHay.includes(t));

  if (sim < MIN_SIMILARIDADE && !(areaHit && sim >= MIN_SIMILARIDADE * 0.75)) {
    return { excluido: true, motivo: `Tema pouco relacionado (similaridade ${sim.toFixed(3)})` };
  }

  // sim ~0.08 (fraco) … ~0.25+ (forte) → ~10..70
  score += Math.min(70, Math.round(((sim - MIN_SIMILARIDADE / 2) / 0.21) * 70));
  if (areaHit) {
    score += 10;
    motivos.push("Área do projeto alinhada");
  }
  if (prazoAberto) {
    score += 10;
    motivos.push("Inscrições abertas");
  }
  if (edital.valor_projeto || edital.valor) score += 3;

  const termos = displayTerms(shared.slice(0, 8).map(([t]) => t), edital).slice(0, 5);
  if (termos.length) motivos.unshift(`Temas em comum: ${termos.join(", ")}`);

  return {
    score: Math.max(0, Math.min(100, score)),
    motivos: [...new Set(motivos)].slice(0, 5),
    termos,
    abrangencia: abr.ufs,
  };
}

/** Mesmo edital raspado por duas fontes (ex.: fapes + sigfapes): mantém o primeiro (maior score). */
export function dedupeMatchesByTitulo<T extends { edital: any }>(sorted: T[]): T[] {
  const vistos = new Set<string>();
  return sorted.filter((r) => {
    const key = normalizeMatchText(r.edital?.titulo).replace(/[^a-z0-9]+/g, " ").trim();
    if (!key) return true;
    if (vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });
}
