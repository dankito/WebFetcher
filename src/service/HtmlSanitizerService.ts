/** For now only makes sure that relative links resolve against the final url: sets `<base href>` if there is none. */
export class HtmlSanitizerService {
  private static readonly BASE_TAG = /<base\s[^>]*\bhref\s*=/i

  sanitize(html: string, finalUrl: string): string {
    if (HtmlSanitizerService.BASE_TAG.test(html)) {
      return html
    }

    const baseTag = `<base href="${this.escapeAttribute(finalUrl)}">`

    const headOpen = /<head(\s[^>]*)?>/i.exec(html)

    if (headOpen) {
      return this.insertAfter(html, headOpen, baseTag)
    }

    const htmlOpen = /<html(\s[^>]*)?>/i.exec(html)

    if (htmlOpen) {
      return this.insertAfter(html, htmlOpen, `<head>${baseTag}</head>`)
    }

    return baseTag + html
  }

  private insertAfter(html: string, match: RegExpExecArray, insertion: string): string {
    const index = match.index + match[0].length

    return html.slice(0, index) + insertion + html.slice(index)
  }

  private escapeAttribute(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
  }

}
