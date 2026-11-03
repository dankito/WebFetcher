import { Hono } from "hono"
import { logger } from "hono/logger"
import { prometheus } from "@hono/prometheus"
import { AppConfigParser } from "./model/AppConfigParser"
import { FetchRouter } from "./routes/FetchRouter"
import { McpRouter } from "./routes/McpRouter"
import { OpenApiRouter } from "./routes/OpenApiRouter"
import { CharsetDecoderService } from "./service/CharsetDecoderService"
import { CamoufoxFetcher } from "./service/fetcher/CamoufoxFetcher"
import { ImpitFetcher } from "./service/fetcher/ImpitFetcher"
import { FetchService } from "./service/FetchService"
import { UrlGuardService } from "./service/UrlGuardService"
import { SetCookieParser } from "./service/SetCookieParser"

const config = new AppConfigParser().parse()

const decoder = new CharsetDecoderService()
// starts downloading Camoufox in the background if it is not installed yet
const camoufoxFetcher = new CamoufoxFetcher(config, decoder)

// the order here is the default order of the engines
const fetchService = new FetchService(
  [new ImpitFetcher(decoder), camoufoxFetcher],
  new UrlGuardService(config.allowLocalAddresses),
)

const app = new Hono()


// add metrics. Include this before app.use("*", logger()) so that requests to /metrics are not logged
const { printMetrics, registerMetrics } = prometheus()
app.use("*", registerMetrics)
app.get("/metrics", printMetrics)

app.use("*", logger()) // request logger always registers for the root, not for basePath

app.route("/", new FetchRouter(fetchService, new SetCookieParser()).router)
app.route("/", new McpRouter(fetchService).router)
app.route("/", new OpenApiRouter(app, config).router)

app.get("/health", context => {
  return context.json({ status: "ok", timestamp: new Date().toISOString() })
})

app.onError((error, context) => {
  console.error("Unhandled error:", error)

  return context.json({ error: error.message }, 500)
})

const root = new Hono()
root.route(config.basePath === "" ? "/" : config.basePath, app)

Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: root.fetch,
  // Bun's default (10 s) would cut off slow fetches; 255 s is the maximum
  idleTimeout: 255,
})

console.log(
  `web-fetcher v${config.version} listening on http://${config.host}:${config.port} (basePath="${config.basePath}", allowLocalAddresses=${config.allowLocalAddresses})`,
)

async function shutdown() {
  await camoufoxFetcher.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
