export type LattesParsed = {
  id: string;
  nome: string;
  resumo?: string;
  areasAtuacao?: string[];
  formacao?: Array<{
    nivel: string;
    curso: string;
    instituicao: string;
    anoConclusao?: string;
  }>;
  linkLattes?: string;
  vinculoInstitucional?: string[];
  enderecoProfissional?: { cidade?: string; uf?: string; pais?: string };
  elegibilidade?: {
    possuiDoutorado: boolean;
    possuiMestrado: boolean;
    possuiGraduacao: boolean;
    podeParticiparEditais: boolean;
    observacoes?: string[];
  };
};

const MAX_PDF_BYTES = 48 * 1024 * 1024;

function cleanText(raw: string): string {
  return String(raw || "")
    .replace(/\u0000/g, " ")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new (PDFParse as any)({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return cleanText(result?.text || "");
  } finally {
    await parser.destroy?.();
  }
}

function extractLattesId(text: string): string | null {
  const labeled = text.match(/ID\s+Lattes:\s*(\d{16})/i);
  if (labeled?.[1]) return labeled[1];
  const url = text.match(/lattes\.cnpq\.br\/(\d{16})/i);
  if (url?.[1]) return url[1];
  return null;
}

function extractNome(text: string): string | null {
  const m = text.match(/^Nome\s*\n+([^\n]+)/im);
  if (m?.[1]) {
    const nome = normalizeSpaces(m[1]);
    if (nome.length > 2 && nome.length < 120 && !/citações|bibliográficas/i.test(nome)) {
      return nome;
    }
  }
  const header = text.slice(0, 800);
  const prof = header.match(
    /Última atualização do currículo em[^\n]+\n+((?:Professor|Professora|Pesquisador|Pesquisadora|Engenheiro|Engenheira|Doutor|Doutora|Mestre|Mestre)[^\n]{10,200})/i,
  );
  if (prof?.[1]) {
    const firstSentence = normalizeSpaces(prof[1].split(/\.\s+/)[0] || "");
    const nomeGuess = firstSentence.match(/^([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,5})/);
    if (nomeGuess?.[1]) return nomeGuess[1];
  }
  return null;
}

function extractResumo(text: string): string | undefined {
  const m = text.match(
    /Última atualização do currículo em[^\n]+\n+([\s\S]{40,2500}?)(?:\nFormação acadêmica|\nFormação Acadêmica|\nEndereço|\nGrande área:)/i,
  );
  if (!m?.[1]) return undefined;
  const resumo = normalizeSpaces(m[1]);
  return resumo.length >= 40 ? resumo.slice(0, 2400) : undefined;
}

function extractAreas(text: string): string[] {
  const idx = text.search(/Áreas de atuação/i);
  if (idx < 0) return [];
  const chunk = text.slice(idx, idx + 8000);
  const areas: string[] = [];
  const re = /Grande área:\s*([^/\n]+)(?:\s*\/\s*Área:\s*([^/\n]+)(?:\s*\/\s*Subárea:\s*([^\n.]+))?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) && areas.length < 12) {
    const parts = [m[1], m[2], m[3]].filter(Boolean).map((p) => normalizeSpaces(String(p)));
    if (parts.length) areas.push(parts.join(" / "));
  }
  return [...new Set(areas)];
}

function extractFormacao(text: string): LattesParsed["formacao"] {
  const idx = text.search(/Formação acadêmica/i);
  const chunk = idx >= 0 ? text.slice(idx, idx + 20000) : text;
  const items: NonNullable<LattesParsed["formacao"]> = [];

  const blockRe =
    /(\d{4})\s*-\s*(\d{4})\s*\n([\s\S]{10,900}?)(?=\n\d{4}\s*-\s*\d{4}\s*\n|\nFormação complementar|\nAtuação Profissional|\nProdução|\nÁreas de atuação|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(chunk)) && items.length < 20) {
    const anoInicio = m[1];
    const anoFim = m[2];
    const body = normalizeSpaces(m[3]);
    if (!body || body.length < 8) continue;

    const nivelMatch = body.match(
      /^(Graduação|Mestrado|Doutorado|Especialização|Curso técnico\/profissionalizante|Curso técnico|MBA|Pós-graduação)[^\n]*/i,
    );
    const nivelRaw = nivelMatch?.[0] || body.slice(0, 80);
    let nivel = "Formação";
    if (/doutorado/i.test(nivelRaw)) nivel = "Doutorado";
    else if (/mestrado/i.test(nivelRaw)) nivel = "Mestrado";
    else if (/graduação|bacharelado|licenciatura/i.test(nivelRaw)) nivel = "Graduação";
    else if (/especialização|pós-graduação|mba/i.test(nivelRaw)) nivel = "Especialização";
    else if (/técnico/i.test(nivelRaw)) nivel = "Técnico";

    const curso =
      normalizeSpaces(
        body
          .replace(/^(Graduação|Mestrado|Doutorado|Especialização|Curso técnico\/profissionalizante em|Curso técnico em|Pós-graduação[^\n]*em)\s*/i, "")
          .split(/\.\s+/)[0] || body.slice(0, 120),
      ) || body.slice(0, 120);

    const inst =
      body.match(
        /(?:Universidade|Instituto|Faculdade|Centro Universitário|Escola)[^.]+\([^)]+\)|(?:Universidade|Instituto|Faculdade|Centro Universitário|Escola)[^.]{5,120}/i,
      )?.[0] || "";

    items.push({
      nivel,
      curso: curso.slice(0, 180),
      instituicao: normalizeSpaces(inst).slice(0, 180) || "Não informado",
      anoConclusao: anoFim || anoInicio,
    });
  }

  return items.length ? items : undefined;
}

function inferElegibilidade(formacao: LattesParsed["formacao"], resumo?: string): LattesParsed["elegibilidade"] {
  const blob = `${resumo || ""} ${(formacao || []).map((f) => `${f.nivel} ${f.curso}`).join(" ")}`.toLowerCase();
  const possuiDoutorado = /doutorado|doutor\b|ph\.?\s*d/.test(blob);
  const possuiMestrado = /mestrado|master\b/.test(blob);
  const possuiGraduacao = /graduação|bacharelado|licenciatura|engenharia|administração/.test(blob);
  const podeParticiparEditais = possuiDoutorado || possuiMestrado || possuiGraduacao;
  return {
    possuiDoutorado,
    possuiMestrado,
    possuiGraduacao,
    podeParticiparEditais,
    observacoes: podeParticiparEditais ? undefined : ["Formação acadêmica não identificada automaticamente no PDF"],
  };
}

function extractVinculo(text: string): string[] | undefined {
  const m = text.match(/(?:Professor|Professora|Pesquisador|Pesquisadora)[^\n.]{8,160}/i);
  if (!m?.[0]) return undefined;
  return [normalizeSpaces(m[0]).slice(0, 180)];
}

export function parseLattesPdfText(text: string): LattesParsed | null {
  const cleaned = cleanText(text);
  if (cleaned.length < 200) return null;

  const id = extractLattesId(cleaned);
  const nome = extractNome(cleaned);
  if (!nome && !id) return null;

  const formacao = extractFormacao(cleaned);
  const resumo = extractResumo(cleaned);
  const areasAtuacao = extractAreas(cleaned);
  const linkLattes = id ? `http://lattes.cnpq.br/${id}` : undefined;

  return {
    id: id || "pdf",
    nome: nome || "Currículo Lattes",
    resumo,
    areasAtuacao: areasAtuacao.length ? areasAtuacao : undefined,
    formacao,
    linkLattes,
    vinculoInstitucional: extractVinculo(cleaned),
    elegibilidade: inferElegibilidade(formacao, resumo),
  };
}

export async function parseLattesPdfBase64(pdfBase64: string): Promise<LattesParsed> {
  const b64 = String(pdfBase64 || "").trim();
  if (!b64) throw new Error("Selecione um arquivo PDF do currículo Lattes.");
  let buffer: Buffer;
  try {
    buffer = Buffer.from(b64, "base64");
  } catch {
    throw new Error("PDF inválido (base64 corrompido).");
  }
  if (!buffer.length || buffer.length < 500) {
    throw new Error("Arquivo PDF muito pequeno ou vazio.");
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error("PDF acima de 48 MB. Exporte um currículo mais enxuto do Lattes.");
  }
  if (buffer.slice(0, 4).toString("utf8") !== "%PDF") {
    throw new Error("Arquivo não parece ser um PDF válido.");
  }

  const text = await extractTextFromPdfBuffer(buffer);
  if (text.length < 200) {
    throw new Error(
      "Não foi possível ler texto do PDF (pode ser escaneado/imagem). Baixe o PDF pelo Lattes (Exportar > PDF) e tente novamente.",
    );
  }

  const parsed = parseLattesPdfText(text);
  if (!parsed) {
    throw new Error(
      "PDF não reconhecido como currículo Lattes. Use o arquivo exportado em lattes.cnpq.br (Currículo Lattes > Exportar > PDF).",
    );
  }
  return parsed;
}
