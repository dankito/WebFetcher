import pkg from "../../package.json"
import { AppConfig } from "./AppConfig"

/**
 * Parses an AppConfig from environment variables: PORT, HOST, BASE_PATH, CAMOUFOX_DATA_DIR,
 * CAMOUFOX_IDLE_TIMEOUT (seconds), ALLOW_LOCAL_ADDRESSES (true / false).
 */
export class AppConfigParser {

  parse(env: Record<string, string | undefined> = process.env): AppConfig {
    const defaults = new AppConfig()

    return new AppConfig(
      pkg.version,
      this.parseNumber(env.PORT, "PORT", defaults.port),
      this.parseString(env.HOST, defaults.host),
      this.parseBasePath(env.BASE_PATH),
      this.parseString(env.CAMOUFOX_DATA_DIR, defaults.camoufoxDataDir),
      this.parseNumber(env.CAMOUFOX_IDLE_TIMEOUT, "CAMOUFOX_IDLE_TIMEOUT", defaults.camoufoxIdleTimeout),
      this.parseBoolean(env.ALLOW_LOCAL_ADDRESSES, "ALLOW_LOCAL_ADDRESSES", defaults.allowLocalAddresses),
    )
  }

  private parseString(value: string | undefined, defaultValue: string): string {
    if (value === undefined || value.trim() === "") {
      return defaultValue
    }

    return value.trim()
  }

  private parseNumber(value: string | undefined, name: string, defaultValue: number): number {
    if (value === undefined || value.trim() === "") {
      return defaultValue
    }

    const parsed = Number(value)

    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid value for ${name}: "${value}"`)
    }

    return parsed
  }

  private parseBoolean(value: string | undefined, name: string, defaultValue: boolean): boolean {
    if (value === undefined || value.trim() === "") {
      return defaultValue
    }

    switch (value.trim().toLowerCase()) {
      case "true":
        return true
      case "false":
        return false
      default:
        throw new Error(`Invalid value for ${name}: "${value}" (expected true or false)`)
    }
  }

  private parseBasePath(value: string | undefined): string {
    const trimmed = (value ?? "").trim().replace(/^\/+|\/+$/g, "")

    if (trimmed === "") {
      return ""
    }

    return `/${trimmed}`
  }

}