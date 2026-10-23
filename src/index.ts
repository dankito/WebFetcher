import { Hono } from "hono"
import { AppConfigParser } from "./model/AppConfigParser"
import { FetchRouter } from "./routes/FetchRouter"
import { McpRouter } from "./routes/McpRouter"
import { OpenApiRouter } from "./routes/OpenApiRouter"
import { CamoufoxBrowserManager } from "./service/engine/CamoufoxBrowserManager"
import { CamoufoxFetchStrategy } from "./service/engine/CamoufoxFetchStrategy"
import { ImpitFetchStrategy } from "./service/engine/ImpitFetchStrategy"
import { CharsetDecoderService } from "./service/CharsetDecoderService"
import { FetchService } from "./service/FetchService"

const config = new AppConfigParser().parse()

const decoder = new CharsetDecoderService()
const camoufoxManager = new CamoufoxBrowserManager(config.camoufoxDataDir, config.camoufoxUnloadTimeout)

// the order here is the default order of the engines
const fetchService = new FetchService([
  new ImpitFetchStrategy(decoder),
  new CamoufoxFetchStrategy(camoufoxManager, decoder),
])

const app = new Hono()
app.route("/", new FetchRouter(fetchService).router)
app.route("/", new McpRouter(fetchService).router)
app.route("/", new OpenApiRouter(app, config).router)

app.onError((error, c) => {
  console.error("Unhandled error:", error)

  return c.json({ error: error.message }, 500)
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
  `web-fetcher v${config.version} listening on http://${config.host}:${config.port} (basePath="${config.basePath}")`,
)

async function shutdown() {
  await camoufoxManager.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
