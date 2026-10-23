import { AppConfig } from "./AppConfig"
import pkg from "../../package.json"

/** Parses an AppConfig from environment variables: PORT, HOST, BASE_PATH, CAMOUFOX_DATA_DIR, CAMOUFOX_UNLOAD_TIMEOUT (seconds). */
export class AppConfigParser {

  parse(env: Record<string, string | undefined> = process.env): AppConfig {
    const defaults = new AppConfig()

    return new AppConfig(
      pkg.version,
      this.parseNumber(env.PORT, "PORT", defaults.port),
      this.parseString(env.HOST, defaults.host),
      this.parseBasePath(env.BASE_PATH),
      this.parseString(env.CAMOUFOX_DATA_DIR, defaults.camoufoxDataDir),
      this.parseNumber(env.CAMOUFOX_UNLOAD_TIMEOUT, "CAMOUFOX_UNLOAD_TIMEOUT", defaults.camoufoxUnloadTimeout),
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

  private parseBasePath(value: string | undefined): string {
    const trimmed = (value ?? "").trim().replace(/^\/+|\/+$/g, "")

    if (trimmed === "") {
      return ""
    }

    return `/${trimmed}`
  }

}