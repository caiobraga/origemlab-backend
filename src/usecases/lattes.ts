import type { Request } from "express";
import { fetch as undiciFetch } from "undici";
import type { AuthUseCases } from "./auth.js";
import { parseLattesPdfBase64 } from "../lib/lattesPdfParser.js";

export type LattesUseCases = {
  parsePdf(req: Request): Promise<{ status: number; body: any }>;
  getById(req: Request): Promise<{ status: number; body: any }>;
};

function isValidLattesId(id: string): boolean {
  return /^\d{16}$/.test(id);
}

export function buildLattesUseCases(deps: { auth: AuthUseCases }): LattesUseCases {
  return {
    async parsePdf(req) {
      let pdfBase64 = String((req as any).body?.pdfBase64 || "").trim();
      const uploaded = (req as any).file as { buffer?: Buffer; mimetype?: string } | undefined;
      if (uploaded?.buffer?.length) {
        pdfBase64 = uploaded.buffer.toString("base64");
      }
      if (!pdfBase64) {
        return {
          status: 400,
          body: {
            error:
              "Não recebemos o arquivo PDF. Use o botão de envio e selecione o .pdf exportado do Lattes.",
          },
        };
      }
      try {
        const parsed = await parseLattesPdfBase64(pdfBase64);
        return { status: 200, body: parsed };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao processar PDF";
        return { status: 400, body: { error: msg } };
      }
    },

    async getById(req) {
      const id = String(req.params.id || "").replace(/\D/g, "");
      if (!isValidLattesId(id)) {
        return { status: 400, body: { error: "ID Lattes inválido" } };
      }

      const linkLattes = `http://lattes.cnpq.br/${id}`;
      try {
        const res = await undiciFetch(linkLattes, {
          headers: { "User-Agent": "OrigemLab/1.0 (+https://origemlab.com.br)" },
          redirect: "follow",
        });
        const html = res.ok ? await res.text() : "";
        const nomeMatch = html.match(/<h2[^>]*>([^<]{3,120})<\/h2>/i) || html.match(/Nome:\s*([^<\n]{3,120})/i);
        const nome = nomeMatch?.[1] ? nomeMatch[1].replace(/\s+/g, " ").trim() : `Pesquisador ${id.slice(0, 4)}`;

        return {
          status: 200,
          body: {
            id,
            nome,
            linkLattes,
            elegibilidade: {
              possuiDoutorado: false,
              possuiMestrado: false,
              possuiGraduacao: false,
              podeParticiparEditais: true,
              observacoes: ["Informações completas disponíveis no site do Lattes"],
            },
          },
        };
      } catch {
        return {
          status: 200,
          body: {
            id,
            nome: `Pesquisador ${id.slice(0, 4)}`,
            linkLattes,
            elegibilidade: {
              possuiDoutorado: false,
              possuiMestrado: false,
              possuiGraduacao: false,
              podeParticiparEditais: true,
              observacoes: ["Informações completas disponíveis no site do Lattes"],
            },
          },
        };
      }
    },
  };
}
