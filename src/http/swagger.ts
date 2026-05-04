import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import type { AppConfig } from "../config.js";
import { buildOpenApiDocument } from "./openapi-spec.js";

/**
 * Swagger UI em `/` e especificação em `/openapi.json`.
 * Montar **depois** do router para não interceptar `/health`, `/api/*`, etc.
 */
export function installSwagger(app: Express, config: AppConfig): void {
  const spec = buildOpenApiDocument(config.auth.cookieName);

  app.get("/openapi.json", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(spec);
  });

  app.use(
    "/",
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      explorer: true,
      customSiteTitle: "Origemlab API",
      swaggerOptions: {
        persistAuthorization: true,
        tryItOutEnabled: true,
      },
    }),
  );
}
