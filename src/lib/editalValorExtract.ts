/**
 * Extração de valores monetários em BRL a partir de textos de editais.
 * Suporta faixas múltiplas, centavos e valor por extenso entre parênteses.
 */

const BRL_AMOUNT_PATTERN = /r\s*\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/gi;

const WRITTEN_NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
  cento: 100,
  duzentos: 200,
  trezentos: 300,
  quatrocentos: 400,
  quinhentos: 500,
  seiscentos: 600,
  setecentos: 700,
  oitocentos: 800,
  novecentos: 900,
};

function normalizeWrittenText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBrazilianMoneyToken(raw: string): number | null {
  let s = String(raw || "")
    .trim()
    .replace(/\s/g, "");
  if (!s) return null;

  if (/,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/\.\d{3}/.test(s)) {
    s = s.replace(/\./g, "");
  }

  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Ex.: "(dois milhões quatrocentos e noventa e seis mil reais)" → 2496000 */
export function parseWrittenPortugueseMoneyPhrase(text: string): number | null {
  const norm = normalizeWrittenText(text).replace(/\breais?\b/g, " ").replace(/\s+/g, " ").trim();
  if (!norm || !/\b(mil|milhao|milhoes)\b/.test(norm)) return null;

  const tokens = norm.split(/\s+/).filter(Boolean);
  let acc = 0;
  let current = 0;

  for (const tok of tokens) {
    if (tok === "e") continue;
    if (tok === "milhoes" || tok === "milhao") {
      current = (current || 1) * 1_000_000;
      acc += current;
      current = 0;
      continue;
    }
    if (tok === "mil") {
      current = (current || 1) * 1_000;
      acc += current;
      current = 0;
      continue;
    }
    const n = WRITTEN_NUMBER_WORDS[tok];
    if (n != null) current += n;
  }

  acc += current;
  return acc > 0 ? acc : null;
}

function amountsAreNear(a: number, b: number): boolean {
  const base = Math.max(a, b, 1);
  return Math.abs(a - b) / base < 0.01;
}

/** Segmentos legíveis: "R$ 400.000,00 para Faixa A", … */
export function extractValorTextSegments(text: string): string[] {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return [];

  const byConnector = s.split(/\s+e\s+(?=r\s*\$)/i).map((p) => p.trim()).filter(Boolean);
  if (byConnector.length > 1) return byConnector;

  const matches = [...s.matchAll(BRL_AMOUNT_PATTERN)];
  if (matches.length <= 1) return [s];

  const segments: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? s.length) : s.length;
    let chunk = s.slice(start, end).replace(/\s+e\s*$/i, "").trim();
    if (chunk.endsWith(" e")) chunk = chunk.slice(0, -2).trim();
    if (chunk) segments.push(chunk);
  }
  return segments.length > 0 ? segments : [s];
}

export function extractBRLAmountsFromText(text: string): number[] {
  const amounts: number[] = [];
  const s = String(text || "");
  if (!s.trim() || s.toLowerCase() === "não informado") return amounts;

  for (const m of s.matchAll(BRL_AMOUNT_PATTERN)) {
    const n = parseBrazilianMoneyToken(m[1]);
    if (n) amounts.push(n);
  }

  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:milhões|milhoes|milhão|milhao)\b/gi)) {
    const base = parseBrazilianMoneyToken(m[1].replace(",", "."));
    if (base) amounts.push(base * 1_000_000);
  }

  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*mil\b/gi)) {
    const base = parseBrazilianMoneyToken(m[1].replace(",", "."));
    if (base) amounts.push(base * 1_000);
  }

  for (const m of s.matchAll(/\(([^)]+)\)/g)) {
    const written = parseWrittenPortugueseMoneyPhrase(m[1]);
    if (written && !amounts.some((a) => amountsAreNear(a, written))) {
      amounts.push(written);
    }
  }

  return amounts;
}

function looksLikeMultiTierValor(text: string): boolean {
  return /\bfaixa\s+[a-z0-9]\b|\bfaixas\b|\bcategoria\b|\bn[ií]vel\b|\bmodalidade\b|\btipo\s+[a-z]\b|\bgrupo\s+[a-z0-9]\b/i.test(
    text,
  );
}

/** Agrega valores extraídos: soma faixas; caso contrário usa o maior (teto). */
export function aggregateValorEnvelopeBRL(amounts: number[], sourceText = ""): number | null {
  const filtered = amounts.filter((n) => n >= 100);
  if (filtered.length === 0) return null;

  const uniq = [...new Set(filtered.map((n) => Math.round(n * 100) / 100))].sort((a, b) => b - a);
  if (uniq.length === 1) return uniq[0];

  const text = String(sourceText || "");
  if (looksLikeMultiTierValor(text) || /\s+e\s+r\s*\$/i.test(text)) {
    return uniq.reduce((sum, n) => sum + n, 0);
  }

  return uniq[0];
}

export function extractBRLAmountsFromValue(value: unknown): number[] {
  if (value == null || value === "Não informado") return [];

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return [value];
  }

  if (typeof value === "string") {
    const t = value.trim();
    if (!t || t.toLowerCase() === "não informado") return [];
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return extractBRLAmountsFromValue(JSON.parse(t));
      } catch {
        return extractBRLAmountsFromText(t);
      }
    }
    return extractBRLAmountsFromText(t);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractBRLAmountsFromValue(item));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const amounts: number[] = [];

    if (typeof obj.montante === "string" || typeof obj.montante === "number") {
      amounts.push(...extractBRLAmountsFromValue(obj.montante));
    }
    if (typeof obj.valor === "string" || typeof obj.valor === "number" || Array.isArray(obj.valor)) {
      amounts.push(...extractBRLAmountsFromValue(obj.valor));
    }

    for (const v of Object.values(obj)) {
      if (v === obj.montante || v === obj.valor) continue;
      amounts.push(...extractBRLAmountsFromValue(v));
    }

    return amounts;
  }

  return [];
}

export function extractValorEnvelopeBRL(valorProjeto: unknown, valorFallback?: unknown): number | null {
  const texts: string[] = [];
  for (const v of [valorProjeto, valorFallback]) {
    if (typeof v === "string") texts.push(v);
    else if (v != null) texts.push(JSON.stringify(v));
  }
  const sourceText = texts.join(" ");
  const amounts = [
    ...extractBRLAmountsFromValue(valorProjeto),
    ...extractBRLAmountsFromValue(valorFallback),
  ];
  return aggregateValorEnvelopeBRL(amounts, sourceText);
}

export function formatValorPlainTextForDisplay(text: string): {
  display: string;
  details?: string[];
} {
  const segments = extractValorTextSegments(text);
  if (segments.length <= 1) {
    const single = segments[0] || text;
    const paren = /\([^)]+\)/.exec(single);
    const display = paren ? single.replace(paren[0], "").replace(/\s+/g, " ").trim() : single;
    return { display: display || single };
  }

  const sorted = [...segments].sort((a, b) => {
    const na = extractBRLAmountsFromText(a)[0] ?? 0;
    const nb = extractBRLAmountsFromText(b)[0] ?? 0;
    return nb - na;
  });

  return {
    display: sorted[0],
    details: segments,
  };
}
