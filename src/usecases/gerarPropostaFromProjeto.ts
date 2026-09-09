import type { AppConfig } from "../config.js";
import type { SupabaseGateway } from "../infra/gateways.js";
import { ollamaChatGenerate, resolveFieldLlmOptions } from "../infra/ollama.js";
import { isOllamaConnectionError } from "../infra/ollamaHealth.js";

type CampoPath = string; // dot path into campos_formulario

type AdaptField = {
  path: CampoPath;
  name: string;
  description: string;
  wordLimit: number | null;
  /** If true, parse numbered lines into objetivos_especificos array */
  asObjetivosEspecificos?: boolean;
  marker: string;
};

const ADAPT_FIELDS: AdaptField[] = [
  {
    path: "titulo_projeto",
    name: "Título do projeto",
    description: "Título claro e específico da proposta adaptada a este edital.",
    wordLimit: 25,
    marker: "TITULO",
  },
  {
    path: "detalhamento_projeto.resumo_publicavel",
    name: "Resumo publicável",
    description:
      "Resumo do projeto com objetivo geral, caminho de desenvolvimento e resultados esperados, alinhado ao edital.",
    wordLimit: 500,
    marker: "RESUMO",
  },
  {
    path: "detalhamento_projeto.caracterizacao_problema",
    name: "Caracterização do problema",
    description:
      "Problema científico/tecnológico, contexto e justificativa alinhados aos critérios e foco do edital.",
    wordLimit: 2500,
    marker: "PROBLEMA",
  },
  {
    path: "detalhamento_projeto.objetivo_geral",
    name: "Objetivo geral",
    description: "Uma formulação clara do objetivo geral, coerente com o edital e com o projeto-fonte.",
    wordLimit: 100,
    marker: "OBJETIVO_GERAL",
  },
  {
    path: "detalhamento_projeto.objetivos_especificos",
    name: "Objetivos específicos",
    description:
      "Liste 3 a 6 objetivos específicos numerados (um por linha), concretos e verificáveis, adaptados ao edital.",
    wordLimit: 400,
    asObjetivosEspecificos: true,
    marker: "OBJETIVOS_ESPECIFICOS",
  },
  {
    path: "detalhamento_projeto.detalhamento_projeto",
    name: "Detalhamento / metodologia",
    description:
      "Metodologia, etapas, entregas e gestão do projeto, adaptadas às exigências e linguagem do edital.",
    wordLimit: 3000,
    marker: "METODOLOGIA",
  },
  {
    path: "detalhamento_projeto.beneficios_resultados_esperados",
    name: "Benefícios e resultados esperados",
    description:
      "Benefícios, produtos, formação de RH e impactos socioeconômicos esperados, alinhados ao edital.",
    wordLimit: 1000,
    marker: "RESULTADOS",
  },
  {
    path: "detalhamento_projeto.impactos_esperados.impacto_cientifico",
    name: "Impacto científico",
    description: "Impacto científico esperado do projeto no contexto deste edital.",
    wordLimit: 300,
    marker: "IMPACTO_CIENTIFICO",
  },
  {
    path: "detalhamento_projeto.impactos_esperados.impacto_tecnologico",
    name: "Impacto tecnológico",
    description: "Impacto tecnológico / inovação esperado, alinhado ao edital.",
    wordLimit: 300,
    marker: "IMPACTO_TECNOLOGICO",
  },
  {
    path: "detalhamento_projeto.impactos_esperados.impacto_economico",
    name: "Impacto econômico",
    description: "Impacto econômico esperado, alinhado ao edital.",
    wordLimit: 300,
    marker: "IMPACTO_ECONOMICO",
  },
  {
    path: "detalhamento_projeto.impactos_esperados.impacto_social_ambiental",
    name: "Impacto social/ambiental",
    description: "Impacto social e/ou ambiental esperado, alinhado ao edital.",
    wordLimit: 300,
    marker: "IMPACTO_SOCIAL",
  },
  {
    path: "detalhamento_projeto.qualificacao_equipe",
    name: "Qualificação da equipe",
    description: "Experiência e qualificação da equipe com base no material do projeto, no tom do edital.",
    wordLimit: 2000,
    marker: "EQUIPE",
  },
  {
    path: "detalhamento_projeto.descricao_avancao_cti",
    name: "Avanço CTI / inovação",
    description: "Avanço científico, tecnológico ou de inovação proporcionado, alinhado ao edital.",
    wordLimit: 1000,
    marker: "AVANCO_CTI",
  },
  {
    path: "detalhamento_projeto.potencial_fortalecimento_linha_pesquisa",
    name: "Potencial de fortalecimento da linha de pesquisa",
    description: "Importância regional e potencial de fortalecer a linha de pesquisa, no contexto do edital.",
    wordLimit: 1000,
    marker: "FORTALECIMENTO",
  },
  {
    path: "detalhamento_projeto.caracterizacao_interdisciplinaridade",
    name: "Interdisciplinaridade",
    description: "Interdisciplinaridade, intercâmbio e parcerias possíveis, alinhados ao edital.",
    wordLimit: 1000,
    marker: "INTERDISCIPLINARIDADE",
  },
  {
    path: "detalhamento_projeto.caracterizacao_contribuicao_inovacao",
    name: "Contribuição / inovação",
    description: "Caracterize a contribuição ou inovação do projeto conforme o perfil do edital.",
    wordLimit: 1000,
    marker: "CONTRIBUICAO",
  },
  {
    path: "detalhamento_projeto.referencias",
    name: "Referências",
    description: "Referências bibliográficas relevantes a partir do material do projeto (não invente DOIs).",
    wordLimit: 800,
    marker: "REFERENCIAS",
  },
  {
    path: "detalhamento_projeto.promocao_popularizacao.publico_alvo",
    name: "Público-alvo (popularização)",
    description: "Público-alvo para promoção e divulgação científica, alinhado ao edital e ao projeto.",
    wordLimit: 300,
    marker: "PUBLICO_ALVO",
  },
  {
    path: "detalhamento_projeto.promocao_popularizacao.estrategias_traducao_conhecimento",
    name: "Estratégias de tradução do conhecimento",
    description: "Estratégias para comunicar resultados a públicos não especializados.",
    wordLimit: 1000,
    marker: "TRADUCAO",
  },
  {
    path: "detalhamento_projeto.promocao_popularizacao.estrategias_disseminacao_conhecimento",
    name: "Estratégias de disseminação",
    description: "Canais, eventos e parcerias para disseminar o conhecimento.",
    wordLimit: 1000,
    marker: "DISSEMINACAO",
  },
  {
    path: "detalhamento_projeto.infraestrutura_apoio_tecnico",
    name: "Infraestrutura e apoio técnico",
    description: "Infraestrutura disponível e apoio técnico para execução, com base no projeto.",
    wordLimit: 1000,
    marker: "INFRAESTRUTURA",
  },
  {
    path: "coordenador_projeto.resumo_experiencia_profissional",
    name: "Experiência do coordenador",
    description: "Resumo da experiência profissional do coordenador a partir da equipe/qualificação do projeto.",
    wordLimit: 500,
    marker: "COORD_EXPERIENCIA",
  },
];

function asRecord(v: unknown): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function joinLines(...parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter(Boolean)
    .join("\n\n");
}

function getByPath(obj: Record<string, any>, path: string): unknown {
  return path.split(".").reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setByPath(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (!cur[key] || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]!] = value;
}

function enforceWordLimit(text: string, wordLimit: number | null | undefined): string {
  if (!wordLimit || !Number.isFinite(wordLimit) || wordLimit <= 0) return text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= wordLimit) return text.trim();
  return words.slice(0, wordLimit).join(" ");
}

function flattenProjetoForPrompt(projeto: any): string {
  const c = asRecord(projeto?.conteudo);
  const origem = asRecord(c.origem);
  const parts = [
    projeto?.titulo ? `Título: ${projeto.titulo}` : "",
    projeto?.resumo ? `Resumo (meta): ${projeto.resumo}` : "",
    projeto?.objetivos ? `Objetivos (meta): ${projeto.objetivos}` : "",
    projeto?.area ? `Área: ${projeto.area}` : "",
    origem.tipo || origem.descricao
      ? `Origem: ${[origem.tipo, origem.descricao, origem.ano].filter(Boolean).join(" — ")}`
      : "",
    Array.isArray(c.palavras_chave) && c.palavras_chave.length
      ? `Palavras-chave: ${c.palavras_chave.join(", ")}`
      : "",
    c.resumo_executivo ? `Resumo executivo:\n${c.resumo_executivo}` : "",
    c.caracterizacao_problema ? `Problema/justificativa:\n${c.caracterizacao_problema}` : "",
    c.objetivo_geral ? `Objetivo geral:\n${c.objetivo_geral}` : "",
    c.objetivos_especificos ? `Objetivos específicos:\n${c.objetivos_especificos}` : "",
    c.metodologia ? `Metodologia:\n${c.metodologia}` : "",
    c.cronograma ? `Cronograma:\n${c.cronograma}` : "",
    c.resultados_esperados ? `Resultados esperados:\n${c.resultados_esperados}` : "",
    c.impactos ? `Impactos:\n${c.impactos}` : "",
    c.equipe ? `Equipe:\n${c.equipe}` : "",
    c.instituicoes ? `Instituições:\n${c.instituicoes}` : "",
    c.orcamento_estimado ? `Orçamento:\n${c.orcamento_estimado}` : "",
    c.referencias ? `Referências:\n${c.referencias}` : "",
    c.texto_completo ? `Texto integral do projeto:\n${String(c.texto_completo).slice(0, 12000)}` : "",
  ];
  const out = joinLines(...parts);
  return out.length > 14000 ? `${out.slice(0, 14000)}\n…` : out;
}

function createEmptyCampos(): Record<string, any> {
  return {
    titulo_projeto: "",
    versao: "1.3",
    eixo_estrategico: { selecionado: null, eixo1_temas: [], eixo2_temas: [], eixo3_temas: [] },
    instituicao_executora: { nome: "", sigla: "", municipio: "", cnpj: "" },
    representante_legal: { nome: "", cargo_ato_nomeacao: "", emails: [""], telefones: [""] },
    coordenador_projeto: {
      nome: "",
      instituicao_vinculo: "",
      departamento: "",
      cargo_exercido: "",
      emails: [""],
      telefones: [""],
      participa_grupo_pesquisa_cnpq: null,
      grupo_pesquisa_cnpq: "",
      cv_lattes: "",
      orcid: "",
      resumo_experiencia_profissional: "",
    },
    detalhamento_projeto: {
      titulo: "",
      modalidade: null,
      duracao_meses: null,
      valor_projeto: "",
      possui_outras_fontes_fomento: null,
      outras_fontes_fomento: "",
      ods_selecionados: [],
      grande_area_conhecimento: null,
      subareas_conhecimento: [],
      tipo_contribuicao_inovacao: [],
      caracterizacao_contribuicao_inovacao: "",
      resumo_publicavel: "",
      palavras_chave: [],
      caracterizacao_problema: "",
      potencial_fortalecimento_linha_pesquisa: "",
      descricao_avancao_cti: "",
      qualificacao_equipe: "",
      objetivo_geral: "",
      objetivos_especificos: [],
      detalhamento_projeto: "",
      caracterizacao_interdisciplinaridade: "",
      promocao_popularizacao: {
        publico_alvo: "",
        estrategias_traducao_conhecimento: "",
        estrategias_disseminacao_conhecimento: "",
      },
      beneficios_resultados_esperados: "",
      impactos_esperados: {
        impacto_cientifico: "",
        impacto_tecnologico: "",
        impacto_economico: "",
        impacto_social_ambiental: "",
      },
      indicadores_acompanhamento: [],
      riscos_mitigacao: [],
      infraestrutura_apoio_tecnico: "",
      referencias: "",
      declaracao_proponente: false,
    },
    equipe_projeto: [],
    recursos_financeiros: {
      materiais_permanentes: [],
      materiais_consumo: [],
      passagens_diarias: [],
      servicos_terceiros: [],
      bolsas: [],
    },
  };
}

/** Seed estrutural (sem IA) a partir do projeto. */
export function seedCamposFromProjeto(projeto: any): Record<string, any> {
  const campos = createEmptyCampos();
  const c = asRecord(projeto?.conteudo);
  const titulo = String(projeto?.titulo || "").trim();
  campos.titulo_projeto = titulo;
  campos.detalhamento_projeto.titulo = titulo;
  campos.detalhamento_projeto.resumo_publicavel = String(c.resumo_executivo || projeto?.resumo || "").trim();
  campos.detalhamento_projeto.palavras_chave = Array.isArray(c.palavras_chave)
    ? c.palavras_chave.map(String).filter(Boolean).slice(0, 6)
    : [];
  campos.detalhamento_projeto.caracterizacao_problema = String(c.caracterizacao_problema || "").trim();
  campos.detalhamento_projeto.objetivo_geral = String(c.objetivo_geral || projeto?.objetivos || "").trim();
  const objText = String(c.objetivos_especificos || "").trim();
  if (objText) {
    campos.detalhamento_projeto.objetivos_especificos = objText
      .split(/\n+/)
      .map((l) => l.replace(/^\s*\d+[\).\-\s]+/, "").trim())
      .filter(Boolean)
      .map((descricao) => ({
        descricao,
        entregas: [],
        criterios_aceitacao: "",
        responsaveis: [],
        cronograma: {},
      }));
  }
  campos.detalhamento_projeto.detalhamento_projeto = joinLines(c.metodologia, c.texto_completo);
  campos.detalhamento_projeto.beneficios_resultados_esperados = String(c.resultados_esperados || "").trim();
  campos.detalhamento_projeto.impactos_esperados.impacto_cientifico = String(c.impactos || "").trim();
  campos.detalhamento_projeto.qualificacao_equipe = String(c.equipe || "").trim();
  campos.detalhamento_projeto.referencias = String(c.referencias || "").trim();
  campos.detalhamento_projeto.valor_projeto = String(c.orcamento_estimado || "").trim();
  campos.detalhamento_projeto.infraestrutura_apoio_tecnico = joinLines(c.instituicoes, c.cronograma);
  campos.detalhamento_projeto.promocao_popularizacao.publico_alvo = String(c.impactos || "").trim().slice(0, 800);
  campos.coordenador_projeto.resumo_experiencia_profissional = String(c.equipe || "").trim().slice(0, 2000);
  if (c.instituicoes) {
    campos.instituicao_executora.nome = String(c.instituicoes).split("—")[0]?.trim() || String(c.instituicoes);
  }
  return campos;
}

function parseObjetivosEspecificos(text: string): Array<Record<string, any>> {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-*•]?\s*\d+[\).\-\s]+/, "").replace(/^\s*[-*•]\s+/, "").trim())
    .filter(Boolean);
  if (!lines.length && text.trim()) {
    return [
      {
        descricao: text.trim(),
        entregas: [],
        criterios_aceitacao: "",
        responsaveis: [],
        cronograma: {},
      },
    ];
  }
  return lines.map((descricao) => ({
    descricao,
    entregas: [],
    criterios_aceitacao: "",
    responsaveis: [],
    cronograma: {},
  }));
}

function buildAdaptPrompt(input: {
  field: AdaptField;
  projetoBlock: string;
  editalBlock: string;
  seedText: string;
}): string {
  const limits = input.field.wordLimit
    ? `Limite: no máximo ${input.field.wordLimit} palavras.`
    : "";
  return [
    "Você é um redator especializado em propostas de fomento.",
    "Tarefa: ADAPTAR o material do PROJETO-FONTE para ESTE campo da proposta deste EDITAL.",
    "Use os fatos, objetivos e conteúdo do projeto. NÃO invente dados, números, parceiros ou resultados inexistentes.",
    "Reescreva no tom e foco do edital (elegibilidade, prioridade temática, linguagem institucional).",
    "Não copie descrição genérica do programa de fomento.",
    "Responda APENAS com o texto final do campo, sem markdown de título e sem explicações.",
    "",
    `Campo: ${input.field.name}`,
    `Instrução do campo: ${input.field.description}`,
    limits,
    "",
    "=== PROJETO-FONTE (fonte da verdade do conteúdo) ===",
    input.projetoBlock || "(vazio)",
    "",
    "=== EDITAL (referência de adaptação) ===",
    input.editalBlock || "(sem resumo estruturado)",
    "",
    input.seedText
      ? `=== RASCUNHO INICIAL (opcional — melhore/adapte; não ignore o edital) ===\n${input.seedText}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function applyFieldValue(
  campos: Record<string, any>,
  field: AdaptField,
  rawText: string,
): void {
  let text = enforceWordLimit(String(rawText || "").trim(), field.wordLimit);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("“") && text.endsWith("”"))) {
    text = text.slice(1, -1).trim();
  }
  if (!text) return;
  if (field.asObjetivosEspecificos) {
    setByPath(campos, field.path, parseObjetivosEspecificos(text));
  } else {
    setByPath(campos, field.path, text);
    if (field.path === "titulo_projeto") {
      setByPath(campos, "detalhamento_projeto.titulo", text);
    }
  }
}

export type AdaptProgress = {
  current: number;
  total: number;
  field: string;
};

export type GerarPropostaFromProjetoResult = {
  campos: Record<string, any>;
  fieldsAdapted: string[];
  fieldsFailed: Array<{ field: string; error: string }>;
};

export function getAdaptFieldsTotal(): number {
  return ADAPT_FIELDS.length;
}

/** Adapta campos narrativos do formulário com IA (projeto + edital), campo a campo. */
export async function adaptCamposWithAi(deps: {
  config: AppConfig;
  supabase: SupabaseGateway;
  projeto: any;
  editalId: string;
  seed: Record<string, any>;
  onProgress?: (p: AdaptProgress) => void | Promise<void>;
}): Promise<GerarPropostaFromProjetoResult> {
  const projetoBlock = flattenProjetoForPrompt(deps.projeto);
  const ctx = await deps.supabase.fetchAiFieldContext({ editalId: deps.editalId });
  const editalBlock = String(ctx.editalSummary || "").slice(0, 3500);

  const campos = JSON.parse(JSON.stringify(deps.seed)) as Record<string, any>;
  const fieldsAdapted: string[] = [];
  const fieldsFailed: Array<{ field: string; error: string }> = [];
  const total = ADAPT_FIELDS.length;

  for (let i = 0; i < ADAPT_FIELDS.length; i++) {
    const field = ADAPT_FIELDS[i]!;
    await deps.onProgress?.({
      current: i + 1,
      total,
      field: field.name,
    });

    const seedVal = getByPath(campos, field.path);
    const seedText =
      field.asObjetivosEspecificos && Array.isArray(seedVal)
        ? seedVal.map((o: any, idx: number) => `${idx + 1}. ${o?.descricao || ""}`).join("\n")
        : String(seedVal || "").trim();

    try {
      const llmOpts = await resolveFieldLlmOptions(deps.config, {
        word_limit: field.wordLimit,
        char_limit: null,
      });
      const raw = await ollamaChatGenerate(
        deps.config,
        buildAdaptPrompt({ field, projetoBlock, editalBlock, seedText }),
        llmOpts,
      );
      if (String(raw || "").trim()) {
        applyFieldValue(campos, field, raw);
        fieldsAdapted.push(field.name);
      } else {
        fieldsFailed.push({ field: field.name, error: "IA retornou vazio" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fieldsFailed.push({ field: field.name, error: msg });
      if (isOllamaConnectionError(e)) break;
    }
  }

  return { campos, fieldsAdapted, fieldsFailed };
}
