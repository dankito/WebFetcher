import { swaggerUI } from "@hono/swagger-ui"
import { Hono } from "hono"
import { type GenerateSpecOptions, openAPIRouteHandler } from "hono-openapi"
import type { AppConfig } from "../model/AppConfig"
import pkg from "../../package.json" with { type: "json" }

/** Adds `/openapi.json` and `/swagger-ui`. `app` is the Hono app whose routes get documented (without base path). */
export class OpenApiRouter {

  static readonly OpenApiDocumentation: Partial<GenerateSpecOptions> = {
    documentation: {
      info: {
        title: "Web Fetcher",
        version: pkg.version,
        description: "Fetches urls and circumvents anti-bot detection: Impit first, Camoufox as fallback.",
      },
    },
  }


  readonly router = new Hono()

  constructor(app: Hono, config: AppConfig) {
    this.router.get(
      "/openapi.json",
      openAPIRouteHandler(app, OpenApiRouter.OpenApiDocumentation),
    )

    this.router.get("/swagger-ui", swaggerUI({
      url: `${config.basePath}/openapi.json`,
      tryItOutEnabled: true,
    }))
  }
}
