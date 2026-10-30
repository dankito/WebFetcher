import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/**
 * SSRF protection: rejects urls that point to localhost, private networks, link-local addresses (e.g. cloud
 * metadata services) etc. Host names are resolved and every resulting address is checked.
 *
 * Known limits: only the initial url is checked, not the targets of redirects. And the check and the actual
 * connection resolve the host name independently (DNS rebinding).
 */
export class UrlGuardService {

  private static readonly LOCAL_HOST_NAMES = ["localhost"]
  private static readonly LOCAL_HOST_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal"]


  constructor(private readonly allowLocalAddresses: boolean) {}


  /** Returns why the url is not allowed, or undefined if it is allowed. */
  async findViolation(url: string): Promise<string | undefined> {
    if (this.allowLocalAddresses) {
      return undefined
    }

    if (!URL.canParse(url)) {
      return `Invalid url "${url}"`
    }

    // WHATWG URL already normalized e.g. decimal / hex IPv4 notations (http://2130706433/ -> 127.0.0.1)
    const hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")

    if (this.isLocalHostName(hostname)) {
      return this.violation(hostname, hostname)
    }

    if (isIP(hostname) !== 0) {
      return this.isLocalAddress(hostname) ? this.violation(hostname, hostname) : undefined
    }

    const addresses = await this.resolve(hostname)
    const localAddress = addresses.find(address => this.isLocalAddress(address))

    return localAddress === undefined ? undefined : this.violation(hostname, localAddress)
  }

  private violation(hostname: string, address: string): string {
    const resolved = hostname === address ? "" : ` (resolves to ${address})`

    return `Fetching local or private addresses is not allowed: ${hostname}${resolved}`
  }

  private isLocalHostName(hostname: string): boolean {
    return (
      UrlGuardService.LOCAL_HOST_NAMES.includes(hostname) ||
      UrlGuardService.LOCAL_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
    )
  }

  /** Resolution errors yield no addresses: the fetch itself will fail with a proper network error. */
  private async resolve(hostname: string): Promise<string[]> {
    try {
      const results = await lookup(hostname, { all: true })

      return results.map(result => result.address.split("%")[0] ?? result.address)
    } catch {
      return []
    }
  }

  private isLocalAddress(address: string): boolean {
    const version = isIP(address)

    if (version === 4) {
      return this.isLocalIPv4(address.split(".").map(Number))
    }

    if (version === 6) {
      return this.isLocalIPv6(this.ipv6ToBytes(address))
    }

    return false
  }

  private isLocalIPv4(octets: number[]): boolean {
    const [a = 0, b = 0, c = 0] = octets

    return (
      a === 0 || // "this" network
      a === 10 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a === 127 ||
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast, reserved, broadcast
    )
  }

  private isLocalIPv6(bytes: number[]): boolean {
    const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = bytes
    const first10Zero = bytes.slice(0, 10).every(byte => byte === 0)

    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d, includes :: and ::1)
    if ((first10Zero && bytes[10] === 0xff && bytes[11] === 0xff) || bytes.slice(0, 12).every(byte => byte === 0)) {
      return this.isLocalIPv4(bytes.slice(12))
    }

    // NAT64 (64:ff9b::/96)
    if (b0 === 0x00 && b1 === 0x64 && b2 === 0xff && b3 === 0x9b && bytes.slice(4, 12).every(byte => byte === 0)) {
      return this.isLocalIPv4(bytes.slice(12))
    }

    // 6to4 (2002::/16) embeds an IPv4 address
    if (b0 === 0x20 && b1 === 0x02) {
      return this.isLocalIPv4(bytes.slice(2, 6))
    }

    return (
      (b0 & 0xfe) === 0xfc || // unique local fc00::/7
      (b0 === 0xfe && (b1 & 0x80) === 0x80) || // link-local fe80::/10 and site-local fec0::/10
      b0 === 0xff // multicast
    )
  }

  /** Expects a valid IPv6 address (checked with isIP). */
  private ipv6ToBytes(address: string): number[] {
    let value = address
    const lastColon = value.lastIndexOf(":")
    const tail = value.slice(lastColon + 1)

    // embedded IPv4 like ::ffff:127.0.0.1 -> two hex groups
    if (tail.includes(".")) {
      const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number)

      value = `${value.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    }

    const [headPart = "", restPart] = value.split("::")
    const head = headPart === "" ? [] : headPart.split(":")
    const rest = restPart === undefined || restPart === "" ? [] : restPart.split(":")
    const zeros = restPart === undefined ? [] : new Array<string>(8 - head.length - rest.length).fill("0")

    return [...head, ...zeros, ...rest].flatMap(group => {
      const number = Number.parseInt(group, 16)

      return [number >> 8, number & 0xff]
    })
  }

}