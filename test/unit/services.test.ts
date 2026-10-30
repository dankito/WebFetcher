import { describe, expect, test } from "bun:test"
import { EngineFailure, EngineFailureKind } from "../../src/model/EngineFailure"
import { FetchEngine } from "../../src/model/FetchEngine"
import { FetchError, FetchErrorReason } from "../../src/model/FetchError"
import { FetchRequest } from "../../src/model/FetchRequest"
import { ContentEncoding, FetchResponse } from "../../src/model/FetchResponse"
import { CharsetDecoderService } from "../../src/service/CharsetDecoderService"
import type { Fetcher } from "../../src/service/fetcher/Fetcher"
import { FetchService } from "../../src/service/FetchService"
import { HtmlSanitizerService } from "../../src/service/HtmlSanitizerService"
import { JsWallDetectorService } from "../../src/service/JsWallDetectorService"
import { Stopwatch } from "../../src/service/Stopwatch"
import { UrlGuardService } from "../../src/service/UrlGuardService"

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap(part => (typeof part === "string" ? [...Buffer.from(part)] : part)))

describe("CharsetDecoderService", () => {
  const decoder = new CharsetDecoderService()

  test("uses charset of the Content-Type header", () => {
    expect(decoder.decode(bytes([0xe4, 0xf6, 0xfc]), "text/plain; charset=iso-8859-1")).toBe("äöü")
  })

  test("uses <meta charset> if the header has none", () => {
    const html = bytes('<html><head><meta charset="windows-1252"></head><body>', [0xe4], "</body></html>")

    expect(decoder.decode(html, "text/html")).toContain("ä")
  })

  test("uses <meta http-equiv> content charset", () => {
    const html = bytes('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">', [0xfc])

    expect(decoder.decode(html, "text/html")).toContain("ü")
  })

  test("does not look at <meta> for unknown or non-HTML content types", () => {
    const html = bytes('<meta charset="iso-8859-1">', [0xc3, 0xa4])

    expect(decoder.decode(html, null)).toContain("ä")
    expect(decoder.decode(html, "text/plain")).toContain("ä")
  })

  test("falls back to utf-8, then to cp1252", () => {
    expect(decoder.decode(bytes("<p>äöü €</p>"), "text/html")).toBe("<p>äöü €</p>")
    expect(decoder.decode(bytes("<p>", [0xe4], "</p>"), "text/html")).toBe("<p>ä</p>")
  })

  test("falls back for unknown charset labels", () => {
    expect(decoder.decode(bytes("abc"), "text/html; charset=nonsense")).toBe("abc")
  })

  test("decodeBody keeps binary content", () => {
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])

    expect(decoder.decodeBody(png, "image/png")).toBe(png)
    expect(decoder.decodeBody(png, null)).toBe(png)
    expect(decoder.decodeBody(bytes("{}"), "application/json")).toBe("{}")
    expect(decoder.decodeBody(bytes("plain"), null)).toBe("plain")
  })
})

describe("HtmlSanitizerService", () => {
  const sanitizer = new HtmlSanitizerService()

  test("adds base href into head", () => {
    expect(sanitizer.sanitize("<html><head><title>t</title></head></html>", "https://a.b/c")).toBe(
      '<html><head><base href="https://a.b/c"><title>t</title></head></html>',
    )
  })

  test("keeps an existing base tag", () => {
    const html = '<head><base href="/x/"></head>'

    expect(sanitizer.sanitize(html, "https://a.b/c")).toBe(html)
  })

  test("creates head or prepends if there is none", () => {
    expect(sanitizer.sanitize("<html><body>x</body></html>", "https://a.b/")).toContain("<head><base")
    expect(sanitizer.sanitize("<p>x</p>", "https://a.b/")).toStartWith("<base")
  })
})

describe("JsWallDetectorService", () => {
  const detector = new JsWallDetectorService()
  const page = (body: string) => `<html><head><title>t</title></head><body>${body}</body></html>`

  test.each([
    ["enable javascript text", page("<p>Please enable JavaScript to continue</p>")],
    ["empty body", "<html><body>  </body></html>"],
    ["empty app div", page('<div id="app"></div><script src="a.js"></script>')],
    ["empty root div", page("<div id='root'></div>")],
    ["cloudflare challenge", page("<script>window._cf_chl_opt = {}</script>")],
    ["noscript only hint", page("<noscript>You need to enable JavaScript</noscript>")],
  ])("detects %s", (_name, html) => {
    expect(detector.requiresJavaScript(html)).toBe(true)
  })

  test("does not flag a complete page with a noscript banner", () => {
    const html = page(`<noscript>Please enable JavaScript</noscript><article>${"real content ".repeat(40)}</article>`)

    expect(detector.requiresJavaScript(html)).toBe(false)
  })

  test("does not flag normal pages", () => {
    expect(detector.requiresJavaScript(page('<div id="app"><h1>Hi</h1></div>'))).toBe(false)
  })
})

describe("UrlGuardService", () => {
  const guard = new UrlGuardService(false)

  test.each([
    "http://localhost/",
    "http://foo.localhost:8080/",
    "http://printer.local/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://0.0.0.0/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[::]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[2002:7f00:1::]/",
  ])("rejects %s", async url => {
    expect(await guard.findViolation(url)).toBeString()
  })

  test.each(["http://8.8.8.8/", "http://172.32.0.1/", "http://[2606:4700:4700::1111]/", "http://[::ffff:8.8.8.8]/"])(
    "allows %s",
    async url => {
      expect(await guard.findViolation(url)).toBeUndefined()
    },
  )

  test("allows everything if local addresses are allowed", async () => {
    expect(await new UrlGuardService(true).findViolation("http://127.0.0.1/")).toBeUndefined()
  })
})

describe("FetchRequest", () => {
  test("timeoutMs", () => {
    expect(new FetchRequest("https://a.b").timeoutMs).toBeUndefined()
    expect(new FetchRequest("https://a.b", 0.5).timeoutMs).toBeUndefined()
    expect(new FetchRequest("https://a.b", 2).timeoutMs).toBe(2000)
  })

  test("followRedirects defaults to true", () => {
    expect(new FetchRequest("https://a.b").followRedirects).toBe(true)
  })

  test("requiresJavaScript / javaScriptDisabled", () => {
    expect(new FetchRequest("https://a.b").requiresJavaScript).toBe(false)
    expect(new FetchRequest("https://a.b", undefined, undefined, true, undefined, true).requiresJavaScript).toBe(true)
    expect(new FetchRequest("https://a.b", undefined, undefined, true, undefined, false).javaScriptDisabled).toBe(true)
    expect(new FetchRequest("https://a.b", undefined, undefined, true, undefined, undefined, true).requiresJavaScript).toBe(true)
  })

  test("cookies are merged into the Cookie header", () => {
    const request = new FetchRequest("https://a.b", undefined, undefined, true, undefined, undefined, undefined, { cookie: "x=1" }, { a: "1", b: "2" })

    expect(request.cookieHeader).toBe("a=1; b=2")
    expect(request.headersWithCookie).toEqual({ cookie: "x=1; a=1; b=2" })
  })
})

describe("Stopwatch", () => {
  test("measures elapsed time", async () => {
    const stopwatch = Stopwatch.start()

    await Bun.sleep(20)

    expect(stopwatch.elapsedMs).toBeGreaterThanOrEqual(15)
  })
})

describe("FetchService", () => {
  const request = (overrides: Partial<ConstructorParameters<typeof FetchRequest>> = []) => {
    const [url = "https://example.com/", timeout, fingerprint, followRedirects = true, engines, executeJavaScript, loadLazyContent] =
      overrides

    return new FetchRequest(url, timeout, fingerprint, followRedirects, engines, executeJavaScript, loadLazyContent)
  }

  class FakeFetcher implements Fetcher {
    calls = 0

    constructor(
      readonly engine: FetchEngine,
      readonly executesJavaScript: boolean,
      private readonly result: () => FetchResponse | EngineFailure,
    ) {}

    async fetch(): Promise<FetchResponse | EngineFailure> {
      this.calls++

      return this.result()
    }
  }

  const response = (engine: FetchEngine, statusCode: number, content: string | Uint8Array, contentType = "text/html") =>
    new FetchResponse(content, statusCode, { "content-type": contentType }, [], 1, "https://example.com/", engine)

  const goodHtml = `<html><head></head><body>${"content ".repeat(50)}</body></html>`
  const guard = new UrlGuardService(false)

  const impitReturning = (result: () => FetchResponse | EngineFailure) => new FakeFetcher(FetchEngine.Impit, false, result)
  const camoufoxReturning = (result: () => FetchResponse | EngineFailure) => new FakeFetcher(FetchEngine.Camoufox, true, result)
  const okImpit = () => impitReturning(() => response(FetchEngine.Impit, 200, goodHtml))
  const okCamoufox = () => camoufoxReturning(() => response(FetchEngine.Camoufox, 200, goodHtml))

  test("returns the first engine's result and sanitizes html", async () => {
    const camoufox = okCamoufox()
    const result = await new FetchService([okImpit(), camoufox], guard).fetchDetails(request())

    expect(result).toBeInstanceOf(FetchResponse)
    expect((result as FetchResponse).engine).toBe(FetchEngine.Impit)
    expect((result as FetchResponse).content).toContain('<base href="https://example.com/">')
    expect(camoufox.calls).toBe(0)
  })

  test("fetchContent returns only the content", async () => {
    const result = await new FetchService([okImpit()], guard).fetchContent(request())

    expect(result).toContain("content content")
  })

  test("does not touch binary content", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const impit = impitReturning(() => response(FetchEngine.Impit, 200, png, "image/png"))
    const result = (await new FetchService([impit], guard).fetchDetails(request())) as FetchResponse

    expect(result.content).toBe(png)
    expect(result.toJSON().contentEncoding).toBe(ContentEncoding.Base64)
    expect(result.toJSON().content).toBe(Buffer.from(png).toString("base64"))
  })

  test("escalates on status > 299", async () => {
    const impit = impitReturning(() => response(FetchEngine.Impit, 403, "blocked"))
    const result = await new FetchService([impit, okCamoufox()], guard).fetchDetails(request())

    expect((result as FetchResponse).engine).toBe(FetchEngine.Camoufox)
  })

  test("escalates on JS wall, but not if executeJavaScript is false", async () => {
    const wall = '<html><body><div id="app"></div></body></html>'
    const impit = impitReturning(() => response(FetchEngine.Impit, 200, wall))
    const service = new FetchService([impit, okCamoufox()], guard)

    expect(((await service.fetchDetails(request())) as FetchResponse).engine).toBe(FetchEngine.Camoufox)
    expect(((await service.fetchDetails(request(["https://example.com/", undefined, undefined, true, undefined, false]))) as FetchResponse).engine).toBe(
      FetchEngine.Impit,
    )
  })

  test("escalates if an engine fails", async () => {
    const impit = impitReturning(() => new EngineFailure(FetchEngine.Impit, EngineFailureKind.Network, "boom"))
    const result = await new FetchService([impit, okCamoufox()], guard).fetchDetails(request())

    expect((result as FetchResponse).engine).toBe(FetchEngine.Camoufox)
  })

  test("executeJavaScript=true skips Impit", async () => {
    const impit = okImpit()
    const result = await new FetchService([impit, okCamoufox()], guard).fetchDetails(
      request(["https://example.com/", undefined, undefined, true, undefined, true]),
    )

    expect((result as FetchResponse).engine).toBe(FetchEngine.Camoufox)
    expect(impit.calls).toBe(0)
  })

  test("respects the requested order", async () => {
    const result = await new FetchService([okImpit(), okCamoufox()], guard).fetchDetails(
      request(["https://example.com/", undefined, undefined, true, [FetchEngine.Camoufox, FetchEngine.Impit]]),
    )

    expect((result as FetchResponse).engine).toBe(FetchEngine.Camoufox)
  })

  test("returns an error with all failures if nothing works", async () => {
    const impit = impitReturning(() => response(FetchEngine.Impit, 500, "x"))
    const result = await new FetchService([impit], guard).fetchDetails(request())

    expect(result).toBeInstanceOf(FetchError)
    expect((result as FetchError).reason).toBe(FetchErrorReason.AllEnginesFailed)
    expect((result as FetchError).engineFailures[0]?.statusCode).toBe(500)
  })

  test("returns Timeout if all engines ran into the timeout", async () => {
    const impit = impitReturning(() => new EngineFailure(FetchEngine.Impit, EngineFailureKind.Timeout, "slow"))
    const result = await new FetchService([impit], guard).fetchDetails(request())

    expect((result as FetchError).reason).toBe(FetchErrorReason.Timeout)
  })

  test("returns NoApplicableEngine", async () => {
    const result = await new FetchService([okImpit()], guard).fetchDetails(
      request(["https://example.com/", undefined, undefined, true, undefined, true]),
    )

    expect((result as FetchError).reason).toBe(FetchErrorReason.NoApplicableEngine)
  })

  test("rejects local addresses without calling an engine", async () => {
    const impit = okImpit()
    const result = await new FetchService([impit], guard).fetchDetails(request(["http://127.0.0.1/"]))

    expect((result as FetchError).reason).toBe(FetchErrorReason.ForbiddenAddress)
    expect(impit.calls).toBe(0)
  })

  test("accepts 3xx without following redirects", async () => {
    const impit = impitReturning(() => response(FetchEngine.Impit, 302, ""))
    const result = await new FetchService([impit], guard).fetchDetails(request(["https://example.com/", undefined, undefined, false]))

    expect((result as FetchResponse).statusCode).toBe(302)
  })
})
