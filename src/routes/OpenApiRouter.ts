import { swaggerUI } from "@hono/swagger-ui"
import { Hono } from "hono"
import { openAPIRouteHandler } from "hono-openapi"
import type { AppConfig } from "../model/AppConfig"

/** Adds `/openapi.json` and `/swagger-ui`. `app` is the Hono app whose routes get documented (without base path). */
export class OpenApiRouter {
  readonly router = new Hono()

  constructor(app: Hono, config: AppConfig) {
    this.router.get(
      "/openapi.json",
      openAPIRouteHandler(app, {
        documentation: {
          info: {
            title: "Web Fetcher",
            version: config.version,
            description: "Fetches urls and circumvents anti-bot detection: Impit first, Camoufox as fallback.",
          },
          servers: [{ url: config.basePath === "" ? "/" : config.basePath }],
        },
      }),
    )

    this.router.get("/swagger-ui", swaggerUI({
      url: `${config.basePath}/openapi.json`,
      tryItOutEnabled: true,
    }))
  }
}
