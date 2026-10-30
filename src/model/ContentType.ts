/** A parsed `Content-Type` header value. */
export class ContentType {

  private static readonly TEXT_MIME_TYPES = new Set([
    "application/json",
    "application/xml",
    "application/xhtml+xml",
    "application/javascript",
    "application/x-javascript",
    "application/ecmascript",
    "application/x-www-form-urlencoded",
    "application/x-ndjson",
    "application/yaml",
    "application/x-yaml",
    "application/graphql",
  ])

  private static readonly CHARSET_REGEX = /^charset\s*=\s*["']?([^\s;"']+)/i


  /** Lower-case mime type without parameters, e.g. `text/html`. Undefined if there is no (valid) header. */
  readonly mimeType: string | undefined
  readonly charset: string | undefined

  constructor(header?: string | null) {
    const trimmed = header?.trim().toLowerCase()

    if (!trimmed) {
      return
    }

    const [mimeType, ...parameters] = trimmed.split(";").map(it => it.trim())

    this.mimeType = mimeType || undefined

    for (const parameter of parameters) {
      const match = ContentType.CHARSET_REGEX.exec(parameter.trim())

      if (match) {
        this.charset = match[1]
        break
      }
    }
  }


  get isHtml(): boolean {
    return this.mimeType === "text/html" || this.mimeType === "application/xhtml+xml"
  }

  get isText(): boolean {
    const mimeType = this.mimeType

    if (mimeType === undefined) {
      return false
    }

    return (
      mimeType.startsWith("text/") ||
      mimeType.endsWith("+json") ||
      mimeType.endsWith("+xml") ||
      ContentType.TEXT_MIME_TYPES.has(mimeType)
    )
  }

  /** Known, but not textual, e.g. images or PDFs. Unknown content types are neither text nor binary. */
  get isBinary(): boolean {
    return this.mimeType !== undefined && !this.isText
  }

}