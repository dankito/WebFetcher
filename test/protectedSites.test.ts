/**
 * Integration tests against real, bot-protected sites. They need internet access and a downloaded Camoufox
 * (`bun run camoufox:fetch`). Sites change, so a failing test can also mean that the site changed its protection.
 *
 * Each site is tested with each engine on its own (`engines: [engine]`, so no escalation).
 * `passes` lists the engines that are expected to get through. All others are expected to fail.
 *
 *   bun test test/protectedSites.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test"
import { FetchEngine } from "../src/model/FetchEngine"
import { AppConfig } from "../src/model/AppConfig"
import { FetchError } from "../src/model/FetchError"
import { FetchRequest } from "../src/model/FetchRequest"
import type { FetchResponse } from "../src/model/FetchResponse"
import { CharsetDecoderService } from "../src/service/CharsetDecoderService"
import { CamoufoxFetcher } from "../src/service/fetcher/CamoufoxFetcher"
import { ImpitFetcher } from "../src/service/fetcher/ImpitFetcher"
import { FetchService } from "../src/service/FetchService"
import { UrlGuardService } from "../src/service/UrlGuardService"

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

const decoder = new CharsetDecoderService()
const camoufoxFetcher = new CamoufoxFetcher(new AppConfig("test", 0, "127.0.0.1", "", "./data/camoufox-test", 5), decoder)
const fetchers = {
  [FetchEngine.Impit]: new ImpitFetcher(decoder),
  [FetchEngine.Camoufox]: camoufoxFetcher,
}

afterAll(async () => {
  await camoufoxFetcher.close()
})

describe.each(Object.values(FetchEngine))("%s", engine => {
  test.each(sites)("$name", async site => {
    const service = new FetchService([fetchers[engine]], new UrlGuardService(false))
    const request = new FetchRequest(site.url, site.timeoutSeconds, undefined, true, [engine])

    if (site.passes.includes(engine)) {
      const response = await service.fetchDetails(request)

      expect(response).not.toBeInstanceOf(FetchError)
      expect(response).toMatchObject({ engine, statusCode: 200 })
      expect((response as FetchResponse).content).toContain(site.expectedText)
    } else {
      expect(await service.fetchDetails(request)).toBeInstanceOf(FetchError)
    }
  }, TEST_TIMEOUT_MS)
})
