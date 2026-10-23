# web-fetcher

Bun / Hono REST API, die eine URL abruft und Anti-Bot-Erkennung umgeht:
zuerst mit [Impit](https://github.com/apify/impit) (Browser-TLS-Fingerprint, kein JS), bei Fehlern, Status > 299
oder erkannter JavaScript-Wall mit [Camoufox](https://github.com/daijro/camoufox) (Anti-Detect-Firefox).

## Start

```sh
bun install
bun run camoufox:fetch   # lädt den Camoufox-Browser (einmalig)
bun run start
```

Konfiguration per Umgebungsvariablen, siehe `.env.example` (`PORT`, `HOST`, `BASE_PATH`, `CAMOUFOX_DATA_DIR`, `CAMOUFOX_UNLOAD_TIMEOUT`).

* `GET|POST {basePath}/fetch`
* `{basePath}/openapi.json`, `{basePath}/swagger-ui`
* `{basePath}/mcp` (MCP, Streamable HTTP, stateless): Tools `fetch_content` und `fetch_details`

## /fetch

Antwortformat über den `Accept`-Header: `application/json` liefert den JSON-Wrapper
(`content`, `statusCode`, `headers`, `cookies`, `elapsedMs`, `finalUrl`, `engine`), alles andere den reinen Inhalt
(Content-Type der Zielseite, immer UTF-8; zusätzlich `X-Fetch-Engine`, `X-Fetch-Status`, `X-Fetch-Final-Url`).

| Parameter | |
|---|---|
| `url` | **erforderlich**, http(s) |
| `timeout` | Sekunden; fehlt oder < 1 = kein Timeout |
| `fingerprint` | `firefox`, `chrome`, `firefox144`, `chrome131`, ... (Default `chrome`). Nicht unterstützte Versionen fallen auf die nächstniedrigere zurück. Camoufox nutzt immer Firefox |
| `followRedirects` | Default `true`. `false` nur mit Impit |
| `strategies` | Liste von `impit`, `camoufox` in Reihenfolge. GET: `strategies=impit,camoufox` |
| `executeJavaScript` | `true`: überspringt Impit. `false`: JS in Camoufox aus, keine Eskalation wegen JS-Wall |
| `loadLazyContent` | `true`: Camoufox scrollt bis zum Ende. Überspringt Impit |
| `headers`, `cookies` | nur POST (JSON-Body) |

Fehler: `400` (keine passende Strategie), `502` (alle Engines gescheitert), `504` (alle liefen in den Timeout);
Body `{ error, attempts: [{ engine, kind, message, statusCode }] }`.

## Hinweise

* Camoufox nutzt zwei persistente Profile unter `CAMOUFOX_DATA_DIR` (`js/` und `nojs/`), weil sich JavaScript nur pro
  Browser abschalten lässt. Cookies werden dadurch zwischen Requests geteilt (z. B. ein Cloudflare-Clearance-Cookie wird wiederverwendet).
  Per Request gesetzte `cookies` landen ebenfalls im Profil.
* Es werden nur Textinhalte unterstützt (Binärdaten wie Bilder / PDFs werden als Text dekodiert und sind damit kaputt).
* Die JS-Wall-Erkennung ist eine Heuristik (siehe `JsWallDetectorService`).
* **Sicherheit:** Der Dienst ruft beliebige URLs ab (SSRF, auch `localhost` und interne Netze). Nicht ungeschützt ins Netz stellen.

## Tests

```sh
bun test                       # Unit-Tests, offline
bun run test:protected         # echte geschützte Seiten, je Engine; braucht Internet und Camoufox
```
