import { describe, expect, test } from "bun:test"
import { FetchEngine } from "../../src/model/FetchEngine"
import { FetchError, FetchErrorKind, FetchFailedError } from "../../src/model/FetchError"
import type { FetchRequest } from "../../src/model/FetchRequest"
import { FetchResponse } from "../../src/model/FetchResponse"
import type { FetchStrategy } from "../../src/service/engine/FetchStrategy"
import { CharsetDecoderService } from "../../src/service/CharsetDecoderService"
import { FetchService } from "../../src/service/FetchService"
import { HtmlSanitizerService } from "../../src/service/HtmlSanitizerService"
import { JsWallDetectorService } from "../../src/service/JsWallDetectorService"

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...Buffer.from(part)] : part)))

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

    expect(decoder.decode(html, null)).toContain("ü")
  })

  test("falls back to utf-8, then to cp1252", () => {
    expect(decoder.decode(bytes("<p>äöü €</p>"), "text/html")).toBe("<p>äöü €</p>")
    expect(decoder.decode(bytes("<p>", [0xe4], "</p>"), "text/html")).toBe("<p>ä</p>")
  })

  test("falls back for unknown charset labels", () => {
    expect(decoder.decode(bytes("abc"), "text/html; charset=nonsense")).toBe("abc")
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

describe("FetchService", () => {
  const params = (overrides: Partial<FetchRequest> = {}): FetchRequest => ({
    url: "https://example.com/",
    followRedirects: true,
    ...overrides,
  })

  class FakeStrategy implements FetchStrategy {
    calls = 0

    constructor(
      public engine: FetchEngine,
      public executesJavaScript: boolean,
      private result: () => FetchResponse,
    ) {}

    async fetch(): Promise<FetchResponse> {
      this.calls++

      return this.result()
    }
  }

  const response = (engine: FetchEngine, statusCode: number, content: string) =>
    new FetchResponse(content, statusCode, { "content-type": "text/html" }, [], 1, "https://example.com/", engine)

  const goodHtml = `<html><head></head><body>${"content ".repeat(50)}</body></html>`

  test("returns the first engine's result and sanitizes html", async () => {
    const impit = new FakeStrategy(FetchEngine.Impit, false, () => response(FetchEngine.Impit, 200, goodHtml))
    const camoufox = new FakeStrategy(FetchEngine.Camoufox, true, () => response(FetchEngine.Camoufox, 200, goodHtml))
    const result = await new FetchService([impit, camoufox]).fetchDetails(params())

    expect(result.engine).toBe(FetchEngine.Impit)
    expect(result.content).toContain('<base href="https://example.com/">')
    expect(camoufox.calls).toBe(0)
  })

  test("escalates on status > 299", async () => {
    const impit = new FakeStrategy(FetchEngine.Impit, false, () => response(FetchEngine.Impit, 403, "blocked"))
    const camoufox = new FakeStrategy(FetchEngine.Camoufox, true, () => response(FetchEngine.Camoufox, 200, goodHtml))
    const result = await new FetchService([impit, camoufox]).fetchDetails(params())

    expect(result.engine).toBe(FetchEngine.Camoufox)
  })

  test("escalates on JS wall, but not if executeJavaScript is false", async () => {
    const wall = "<html><body><div id=\"app\"></div></body></html>"
    const impit = new FakeStrategy(FetchEngine.Impit, false, () => response(FetchEngine.Impit, 200, wall))
    const camoufox = new FakeStrategy(FetchEngine.Camoufox, true, () => response(FetchEngine.Camoufox, 200, goodHtml))
    const service = new FetchService([impit, camoufox])

    expect((await service.fetchDetails(params())).engine).toBe(FetchEngine.Camoufox)
    expect((await service.fetchDetails(params({ executeJavaScript: false }))).engine).toBe(FetchEngine.Impit)
  })

  test("escalates if an engine throws", async () => {
    const impit = new FakeStrategy(FetchEngine.Impit, false, () => {
      throw new FetchError("boom", FetchEngine.Impit, FetchErrorKind.Network)
    })
    const camoufox = new FakeStrategy(FetchEngine.Camoufox, true, () => response(FetchEngine.Camoufox, 200, goodHtml))

    expect((await new FetchService([impit, camoufox]).fetchDetails(params())).engine).toBe(FetchEngine.Camoufox)
  })

  test("executeJavaScript=true skips Impit", async () => {
    const impit = new FakeStrategy(FetchEngine.Impit, false, () => response(FetchEngine.Impit, 200, goodHtml))
    const camoufox = new FakeStrategy(FetchEngine.Camoufox, true, () => response(FetchEngine.Camoufox, 200, goodHtml))
    const result = await new FetchService([impit, camoufox]).fetchDetails(params({ executeJavaScript: true }))

    expect(result.engine).toBe(FetchEngine.Camoufox)
    expect(impit.calls).toBe(0)
  })

  test("respects the requested order", async () => {
    const impit = new FakeStrategy(FetchEngine.Impit, false, () => response(FetchEngine.Impit, 200, goodHtml))
    const camoufox = new FakeStrategy(FetchEngine.Camoufox, true, () => response(FetchEngine.Camoufox, 200, goodHtml))
    const result = await new FetchService([impit, camoufox]).fetchDetails(
      params({ strategies: [FetchEngine.Camoufox, FetchEngine.Impit] }),
    )

    expect(result.engine).toBe(FetchEngine.Camoufox)
  })

  test("bails out with all attempts if nothing works", async () => {
    const impit = new FakeStrategy(FetchEngine.Impit, false, () => response(FetchEngine.Impit, 500, "x"))
    const error = await new FetchService([impit]).fetchDetails(params()).catch((e) => e)

    expect(error).toBeInstanceOf(FetchFailedError)
    expect(error.attempts).toHaveLength(1)
    expect(error.attempts[0].statusCode).toBe(500)
  })

  test("accepts 3xx without following redirects", async () => {
    const impit = new FakeStrategy(FetchEngine.Impit, false, () => response(FetchEngine.Impit, 302, ""))
    const result = await new FetchService([impit]).fetchDetails(params({ followRedirects: false }))

    expect(result.statusCode).toBe(302)
  })
})
