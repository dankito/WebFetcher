# web-fetcher

Bun / Hono REST API, die eine URL abruft und Anti-Bot-Erkennung umgeht:
zuerst mit [Impit](https://github.com/apify/impit) (Browser-TLS-Fingerprint, kein JS), bei Fehlern, Status > 299
oder erkannter JavaScript-Wall mit [Camoufox](https://github.com/daijro/camoufox) (Anti-Detect-Firefox).

## Start

```sh
bun install
bun run camoufox:fetch   # lädt den Camoufox-Browser (einmalig; passiert sonst automatisch im Hintergrund beim Start)
bun run start
```

Konfiguration per Umgebungsvariablen, siehe `.env.example` (`PORT`, `HOST`, `BASE_PATH`, `CAMOUFOX_DATA_DIR`, `CAMOUFOX_IDLE_TIMEOUT`, `ALLOW_LOCAL_ADDRESSES`).

* `GET|POST {basePath}/fetch`: liefert den reinen Inhalt
* `GET|POST {basePath}/fetch/details`: liefert den JSON-Wrapper
* `{basePath}/openapi.json`, `{basePath}/swagger-ui`
* `{basePath}/mcp` (MCP, Streamable HTTP, stateless): Tools `fetch_content` und `fetch_details`

## /fetch und /fetch/details

`/fetch` liefert den Inhalt mit dem Content-Type der Zielseite: Text immer als UTF-8, Binärdaten (Bilder, PDFs, ...) unverändert.
Details stehen in Antwortheaders: `X-Fetch-Engine`, `X-Fetch-Status`, `X-Fetch-Final-Url`, `X-Fetch-Header-<name>`
(jeder Header der Zielseite) und `X-Fetch-Cookie` (jeder rohe `Set-Cookie`-Wert). Viele Clients / Proxies begrenzen die
Gesamtgröße der Antwortheader (z. B. 16 KB), ungültige Werte (nicht-latin1) werden ausgelassen.

`/fetch/details` liefert `content`, `contentEncoding` (`Text` oder `Base64` für Binärdaten), `statusCode`, `headers`,
`cookies` (rohe `Set-Cookie`-Werte), `elapsedMs`, `finalUrl` und `engine`.

| Parameter | |
|---|---|
| `url` | **erforderlich**, http(s) |
| `timeout` | Sekunden; fehlt oder < 1 = kein Timeout |
| `fingerprint` | `firefox`, `chrome`, `firefox144`, `chrome131`, ... (Default `chrome`). Nicht unterstützte Versionen fallen auf die nächstniedrigere zurück. Camoufox nutzt immer Firefox |
| `followRedirects` | Default `true`. Wird von Camoufox ignoriert |
| `engines` | Liste von `Impit`, `Camoufox` in Reihenfolge. GET: `engines=Impit,Camoufox` |
| `executeJavaScript` | `true`: überspringt Impit. `false`: JS in Camoufox aus, keine Eskalation wegen JS-Wall |
| `loadLazyContent` | `true`: Camoufox scrollt bis zum Ende. Überspringt Impit |
| `headers`, `cookies` | nur POST (JSON-Body) |

Fehler (JSON `{ error, reason, engineFailures }`): `400` keine passende Engine, `403` lokale / private Adresse,
`502` alle Engines gescheitert, `504` alle liefen in den Timeout.

## Hinweise

* Camoufox nutzt zwei persistente Profile unter `CAMOUFOX_DATA_DIR` (`js/` und `nojs/`), weil sich JavaScript nur pro
  Browser abschalten lässt. Cookies werden dadurch zwischen Requests geteilt (z. B. ein Cloudflare-Clearance-Cookie wird wiederverwendet).
  Per Request gesetzte `cookies` landen ebenfalls im Profil.
* Binärdaten liefert Impit zuverlässig. Camoufox (ein Browser) kann bei Downloads (z. B. PDFs) scheitern, dann bleibt nur Impit.
* Die JS-Wall-Erkennung ist eine Heuristik (siehe `JsWallDetectorService`).
* **Sicherheit (SSRF):** Standardmäßig werden URLs auf localhost, private Netze (10/8, 172.16/12, 192.168/16, ...), Link-Local
  (z. B. Cloud-Metadaten 169.254.169.254) und IPv6-Entsprechungen abgelehnt; Hostnamen werden aufgelöst und jede Adresse geprüft.
  Mit `ALLOW_LOCAL_ADDRESSES=true` abschaltbar. Grenzen: Geprüft wird nur die angegebene URL, nicht die Ziele von Redirects,
  und DNS-Rebinding zwischen Prüfung und Abruf ist nicht abgedeckt. Den Dienst trotzdem nicht ungeschützt ins Netz stellen.

## Tests

```sh
bun test                       # Unit-Tests, offline
bun run test:protected         # echte geschützte Seiten, je Engine; braucht Internet und Camoufox
```
