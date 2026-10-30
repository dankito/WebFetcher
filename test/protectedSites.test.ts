/**
 * Integration tests against real, bot-protected sites. They need internet access and a downloaded Camoufox
 * (`bun run camoufox:fetch`). Sites change, so a failing test can also mean that the site changed its protection.
 *
 * Each site is tested with each engine on its own (`strategies: [engine]`, so no escalation).
 * `passes` lists the engines that are expected to get through. All others are expected to fail.
 *
 *   bun test test/protectedSites.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test"
import { FetchEngine } from "../src/model/FetchEngine"
import { FetchFailedError } from "../src/model/FetchError"
import type { FetchRequest } from "../src/model/FetchRequest"
import { CamoufoxBrowserManager } from "../src/service/engine/CamoufoxBrowserManager"
import { CamoufoxFetchStrategy } from "../src/service/engine/CamoufoxFetchStrategy"
import { ImpitFetchStrategy } from "../src/service/engine/ImpitFetchStrategy"
import { FetchService } from "../src/service/FetchService"

class ProtectedSite {
  constructor(
    public name: string,
    public url: string,
    /** Text that only shows up if the protection was passed. */
    public expectedText: string,
    public passes: FetchEngine[],
    public timeoutSeconds: number = 60,
  ) {}
}

const sites = [
  // Cloudflare managed challenge (needs JavaScript). Test page of scrapingcourse.com
  new ProtectedSite(
    "Cloudflare challenge",
    "https://www.scrapingcourse.com/cloudflare-challenge",
    "You bypassed the Cloudflare challenge",
    [FetchEngine.Camoufox],
  ),
  // TLS fingerprint check: the echoed JA3 / HTTP2 data must exist, i.e. the request is not rejected
  new ProtectedSite("TLS fingerprint echo", "https://tls.peet.ws/api/all", "ja3", [
    FetchEngine.Impit,
    FetchEngine.Camoufox,
  ]),
]

/** Per test: browser launch + challenge + timeout of the site */
const TEST_TIMEOUT_MS = 120_000

const camoufoxManager = new CamoufoxBrowserManager("./data/camoufox-test", 5)
const strategies = {
  [FetchEngine.Impit]: new ImpitFetchStrategy(),
  [FetchEngine.Camoufox]: new CamoufoxFetchStrategy(camoufoxManager),
}

afterAll(async () => {
  await camoufoxManager.close()
})

describe.each(Object.values(FetchEngine))("%s", (engine) => {
  test.each(sites)("$name", async (site) => {
    const service = new FetchService([strategies[engine]])
    const params: FetchRequest = {
      url: site.url,
      followRedirects: true,
      strategies: [engine],
      timeout: site.timeoutSeconds,
    }

    if (site.passes.includes(engine)) {
      const response = await service.fetchDetails(params)

      expect(response.engine).toBe(engine)
      expect(response.statusCode).toBe(200)
      expect(response.content).toContain(site.expectedText)
    } else {
      await expect(service.fetchDetails(params)).rejects.toBeInstanceOf(FetchFailedError)
    }
  }, TEST_TIMEOUT_MS)
})
