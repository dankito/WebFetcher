/**
 * Heuristically detects HTML that can only be used with JavaScript:
 * JS challenges (Cloudflare & co.), empty app shells and "please enable JavaScript" pages.
 * Plain `<noscript>` hints on otherwise complete pages are deliberately NOT treated as a wall.
 */
export class JsWallDetectorService {
  private static readonly CHALLENGE_PATTERNS: [RegExp, string][] = [
    [/window\._cf_chl/i, "Cloudflare JS challenge (window._cf_chl)"],
    [/_cf_chl_opt/i, "Cloudflare JS challenge (_cf_chl_opt)"],
    [/<title>\s*just a moment\.{0,3}\s*<\/title>/i, "Cloudflare interstitial (\"Just a moment...\")"],
    [/challenges\.cloudflare\.com\/(cdn-cgi\/)?challenge-platform/i, "Cloudflare challenge platform script"],
  ]

  private static readonly EMPTY_SHELL_PATTERNS: [RegExp, string][] = [
    [/<body[^>]*>\s*<\/body>/i, "empty <body>"],
    [/<div[^>]+id=["']app["'][^>]*>\s*<\/div>/i, "empty <div id=\"app\">"],
    [/<div[^>]+id=["']root["'][^>]*>\s*<\/div>/i, "empty <div id=\"root\">"],
    [/<div[^>]+id=["']__next["'][^>]*>\s*<\/div>/i, "empty <div id=\"__next\">"],
  ]

  private static readonly TEXT_PATTERNS: RegExp[] = [
    /please\s+enable\s+javascript/i,
    /enable\s+javascript\s+(to|in\s+order|and\s+cookies)/i,
    /javascript\s+(is\s+)?(required|disabled)/i,
    /you\s+need\s+to\s+enable\s+javascript/i,
    /this\s+(site|page|app|website)\s+requires\s+javascript/i,
  ]

  /** Pages with less visible text than this and a JS hint inside `<noscript>` count as wall. */
  private static readonly MIN_VISIBLE_TEXT_LENGTH = 200

  requiresJavaScript(html: string): boolean {
    return this.detect(html) !== undefined
  }

  /** Returns a human readable reason or undefined if no JS wall was detected. */
  detect(html: string): string | undefined {
    for (const [pattern, reason] of JsWallDetectorService.CHALLENGE_PATTERNS) {
      if (pattern.test(html)) {
        return reason
      }
    }

    const withoutNoscript = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, "")

    for (const [pattern, reason] of JsWallDetectorService.EMPTY_SHELL_PATTERNS) {
      if (pattern.test(withoutNoscript)) {
        return reason
      }
    }

    const visibleText = this.visibleText(withoutNoscript)

    for (const pattern of JsWallDetectorService.TEXT_PATTERNS) {
      if (pattern.test(visibleText)) {
        return `visible text matches ${pattern}`
      }
    }

    const noscriptBlocks = html.match(/<noscript[\s\S]*?<\/noscript>/gi) ?? []
    const hintInNoscript = noscriptBlocks.some(block =>
      JsWallDetectorService.TEXT_PATTERNS.some(pattern => pattern.test(block)),
    )

    if (hintInNoscript && visibleText.length < JsWallDetectorService.MIN_VISIBLE_TEXT_LENGTH) {
      return "JavaScript hint in <noscript> and almost no other content"
    }

    return undefined
  }

  private visibleText(html: string): string {
    return html
      .replace(/<(script|style|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }
}
