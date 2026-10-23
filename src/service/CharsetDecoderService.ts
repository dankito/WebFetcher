/**
 * Decodes response bytes to a string. Charset priority:
 * BOM, Content-Type header, `<meta charset=...>` (HTML only), then fallbacks utf-8 and windows-1252 (= cp1252).
 */
export class CharsetDecoderService {
  private static readonly FALLBACK_CHARSETS = ["utf-8", "windows-1252"]
  private static readonly META_SNIFF_BYTES = 4096

  decode(bytes: Uint8Array, contentType?: string | null): string {
    const candidates: string[] = []

    const bomCharset = this.charsetFromBom(bytes)

    if (bomCharset) {
      candidates.push(bomCharset)
    }

    const headerCharset = this.charsetFromContentType(contentType)

    if (headerCharset) {
      candidates.push(headerCharset)
    }

    if (this.mayBeHtml(contentType)) {
      const metaCharset = this.charsetFromMeta(bytes)

      if (metaCharset) {
        candidates.push(metaCharset)
      }
    }

    candidates.push(...CharsetDecoderService.FALLBACK_CHARSETS)

    for (const charset of candidates) {
      const decoded = this.tryDecode(bytes, charset)

      if (decoded !== undefined) {
        return decoded
      }
    }

    // windows-1252 maps every byte, so this is only reached if the runtime lacks it
    return new TextDecoder("utf-8").decode(bytes)
  }

  private tryDecode(bytes: Uint8Array, charset: string): string | undefined {
    try {
      return new TextDecoder(charset, { fatal: true }).decode(bytes)
    } catch {
      // unknown label or invalid byte sequence for this charset
      return undefined
    }
  }

  private mayBeHtml(contentType?: string | null): boolean {
    if (!contentType) {
      return true
    }

    return /html|xml/i.test(contentType)
  }

  private charsetFromContentType(contentType?: string | null): string | undefined {
    if (!contentType) {
      return undefined
    }

    return /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1]
  }

  private charsetFromMeta(bytes: Uint8Array): string | undefined {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, CharsetDecoderService.META_SNIFF_BYTES))

    // matches <meta charset="x"> as well as <meta http-equiv="Content-Type" content="text/html; charset=x">
    return /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i.exec(head)?.[1]
  }

  private charsetFromBom(bytes: Uint8Array): string | undefined {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return "utf-8"
    }

    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return "utf-16le"
    }

    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return "utf-16be"
    }

    return undefined
  }
}
