/**
 * Apoio de IA para criar Projetos: extrair campos de um PDF enviado
 * ou redigir um rascunho a partir de uma descrição curta.
 * Não persiste nada — quem salva é o front via /api/projetos.
 */

export type ProjetoCampoTexto = {
  key: string;
  label: string;
  hint: string;
};

/** Campos de texto de `conteudo` (espelha ProjetoConteudo no front). */
export const PROJETO_CAMPOS_TEXTO: ProjetoCampoTexto[] = [
  { key: "titulo_ingles", label: "Título em inglês", hint: "tradução fiel do título" },
  { key: "inicio_previsto", label: "Início previsto", hint: "AAAA-MM ou texto curto" },
  { key: "duracao_meses", label: "Duração (meses)", hint: "apenas o número ou texto curto" },
  { key: "resumo_executivo", label: "Resumo executivo", hint: "abstract de 1 a 2 parágrafos" },
  { key: "caracterizacao_problema", label: "Caracterização do problema", hint: "contexto e problema que o projeto resolve" },
  { key: "objetivo_geral", label: "Objetivo geral", hint: "uma frase" },
  { key: "objetivos_especificos", label: "Objetivos específicos", hint: "lista em texto, um por linha" },
  { key: "metas", label: "Metas", hint: "metas e entregas mensuráveis" },
  { key: "metodologia", label: "Metodologia", hint: "como o projeto será executado" },
  { key: "gestao_execucao", label: "Gestão da execução", hint: "governança, equipe e controle" },
  { key: "cronograma", label: "Cronograma", hint: "etapas e prazos em texto livre" },
  { key: "resultados_esperados", label: "Resultados esperados", hint: "entregas concretas" },
  { key: "impactos", label: "Impactos", hint: "efeitos esperados científicos, econômicos ou sociais" },
  { key: "relevancia_setor_produtivo", label: "Relevância para o setor produtivo", hint: "demanda do setor produtivo atendida" },
  { key: "atendimento_demandas_produtivas_sociais", label: "Atendimento a demandas sociais", hint: "demandas sociais ou produtivas atendidas" },
  { key: "instituicoes_colaboradoras", label: "Instituições colaboradoras", hint: "parceiros e colaboradores" },
  { key: "financiamentos_anteriores", label: "Financiamentos anteriores", hint: "fomento já recebido pelo tema" },
  { key: "maturidade_tecnologica", label: "Maturidade tecnológica", hint: "TRL ou estágio atual" },
  { key: "resultados_ja_alcancados", label: "Resultados já alcançados", hint: "histórico do projeto ou da tecnologia" },
  { key: "potencial_producao_tecnologica", label: "Potencial de produção tecnológica", hint: "produtos, patentes, softwares" },
  { key: "potencial_empreendedorismo", label: "Potencial de empreendedorismo", hint: "geração de empresas ou negócios" },
  { key: "sumula_curricular", label: "Súmula curricular", hint: "resumo da experiência da equipe" },
  { key: "sumula_curricular_continuacao", label: "Súmula curricular (continuação)", hint: "complemento da súmula" },
  { key: "equipe", label: "Equipe", hint: "papéis e responsabilidades" },
  { key: "instituicoes", label: "Instituições", hint: "instituições executoras" },
  { key: "orcamento_estimado", label: "Orçamento estimado", hint: "valores ou rubricas em texto" },
  { key: "referencias", label: "Referências", hint: "referências bibliográficas" },
];

const PROJETO_CAMPOS_LISTA = ["palavras_chave", "palavras_chave_ingles"] as const;
const ORIGEM_TIPOS = ["proposta_anterior", "projeto_pesquisa", "ideia_nova", "outro"] as const;

/** Limites de entrada enviada ao modelo (caracteres). */
export const EXTRACT_INPUT_MAX_CHARS = 60_000;
/** Texto integral guardado em `conteudo.texto_completo`. */
export const TEXTO_COMPLETO_MAX_CHARS = 150_000;

const CAMPOS_DESCRICAO = PROJETO_CAMPOS_TEXTO.map((c) => `- "${c.key}": ${c.label} (${c.hint})`).join("\n");

export function buildExtractPrompt(documentText: string): string {
  return [
    "Você lê o texto de um projeto de pesquisa ou proposta de fomento e preenche campos estruturados.",
    "Responda SOMENTE com um objeto JSON válido, sem comentários e sem markdown.",
    "",
    "Campos de topo:",
    '- "titulo": título do projeto (string)',
    '- "resumo": resumo curto de até 3 frases (string)',
    '- "area": uma de "tech", "health", "agro", "energy", "bio", "other" ou "" se não estiver claro',
    '- "palavras_chave": array de 3 a 8 palavras-chave em português',
    '- "palavras_chave_ingles": array com as mesmas palavras-chave em inglês',
    "",
    "Campos de texto (string). Use \"\" quando a informação não existir no documento:",
    CAMPOS_DESCRICAO,
    "",
    "Regras:",
    "- Copie ou resuma apenas o que está no documento. Não invente números, nomes, valores ou instituições.",
    "- Mantenha o português do documento nos campos de texto.",
    "",
    "Documento:",
    "<<<",
    documentText,
    ">>>",
  ].join("\n");
}

export type DraftInput = {
  titulo: string;
  area: string;
  origemTipo: string;
  origemDescricao: string;
  descricao: string;
  publicoAlvo: string;
};

export function buildDraftPrompt(input: DraftInput): string {
  const linhas = [
    `Título: ${input.titulo || "(a definir)"}`,
    `Área: ${input.area || "não informada"}`,
    `Público-alvo: ${input.publicoAlvo || "não informado"}`,
    `Origem do material: ${input.origemTipo || "não informada"}${input.origemDescricao ? ` (${input.origemDescricao})` : ""}`,
    `Descrição fornecida pelo usuário: ${input.descricao || "(nenhuma)"}`,
  ];
  return [
    "Você ajuda a redigir o rascunho inicial de um projeto de pesquisa ou inovação para submissão a editais de fomento brasileiros.",
    "Responda SOMENTE com um objeto JSON válido, sem comentários e sem markdown.",
    "",
    "Dados fornecidos:",
    ...linhas,
    "",
    "Campos de texto (string) a redigir, em português formal e objetivo:",
    CAMPOS_DESCRICAO,
    "",
    "Também inclua:",
    '- "palavras_chave": array de 3 a 8 palavras-chave em português',
    '- "palavras_chave_ingles": array com as mesmas palavras-chave em inglês',
    "",
    "Regras:",
    "- Este é um RASCUNHO: baseie-se nos dados fornecidos e escreva de forma genérica onde faltar informação.",
    "- Não invente dados concretos (valores em reais, números de bolsas, nomes de pessoas ou instituições, resultados já obtidos).",
    "- Quando faltar um dado específico, escreva um marcador entre colchetes, por exemplo [inserir orçamento] ou [inserir nome da instituição].",
    "- Campos que não cabem ao projeto podem ficar vazios (\"\").",
  ].join("\n");
}

/** Extrai o primeiro objeto JSON de uma resposta de modelo (aceita cercas de código). */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = String(raw || "").trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asText(v: unknown, max = 20_000): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join("\n").slice(0, max);
  return String(v).trim().slice(0, max);
}

function asKeywords(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : [];
  return list
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** Mantém só os campos conhecidos de `conteudo`, com tipos corretos. */
export function sanitizeConteudo(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key } of PROJETO_CAMPOS_TEXTO) {
    const text = asText(raw[key]);
    if (text) out[key] = text;
  }
  for (const key of PROJETO_CAMPOS_LISTA) {
    const list = asKeywords(raw[key]);
    if (list.length) out[key] = list;
  }
  return out;
}

export function normalizeArea(raw: unknown): string {
  const v = String(raw || "").trim().toLowerCase();
  return ["tech", "health", "agro", "energy", "bio", "other"].includes(v) ? v : "";
}

export function normalizeOrigemTipo(raw: unknown): string {
  const v = String(raw || "").trim();
  return (ORIGEM_TIPOS as readonly string[]).includes(v) ? v : "";
}

export function countFilledCampos(conteudo: Record<string, unknown>): number {
  return Object.values(conteudo).filter((v) =>
    Array.isArray(v) ? v.length > 0 : String(v ?? "").trim().length > 0,
  ).length;
}
