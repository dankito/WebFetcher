import { ContentType } from "../model/ContentType"

/**
 * Decodes response bytes. Charset priority (each candidate is only determined and tried if the previous failed):
 * BOM, Content-Type header, `<meta charset=...>` (HTML only), then the fallbacks utf-8 and windows-1252 (= cp1252).
 */
export class CharsetDecoderService {

  private static readonly META_SNIFF_BYTES = 4096
  private static readonly BINARY_SNIFF_BYTES = 1024


  /**
   * Decodes textual responses to a string and returns binary ones (known non-text content type, or an unknown
   * content type with NUL bytes) unchanged.
   */
  decodeBody(bytes: Uint8Array, contentTypeHeader?: string | null): string | Uint8Array {
    const contentType = new ContentType(contentTypeHeader)

    if (contentType.isBinary) {
      return bytes
    }

    if (contentType.mimeType === undefined && bytes.subarray(0, CharsetDecoderService.BINARY_SNIFF_BYTES).includes(0)) {
      return bytes
    }

    return this.#decode(bytes, contentType)
  }

  decode(bytes: Uint8Array, contentTypeHeader?: string | null): string {
    return this.#decode(bytes, new ContentType(contentTypeHeader))
  }

  #decode(bytes: Uint8Array, contentType: ContentType): string {
    // suppliers, so that e.g. the meta charset is only looked up if everything before it failed
    const charsetSuppliers: (() => string | undefined)[] = [
      () => this.charsetFromBom(bytes),
      () => contentType.charset,
      () => (contentType.isHtml ? this.charsetFromMeta(bytes) : undefined),
      () => "utf-8",
      () => "windows-1252",
    ]

    for (const supplier of charsetSuppliers) {
      const charset = supplier()

      if (charset === undefined) {
        continue
      }

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
