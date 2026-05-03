import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import type { AppConfig } from "../config.js";
import { buildOpenApiDocument } from "./openapi-spec.js";

/**
 * Registra Swagger UI em `/` e o JSON em `/openapi.json`.
 * Deve ser montado **depois** do router da API para não interceptar `/api/*` nem `/health`.
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
