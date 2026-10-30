export class AppConfig {

  constructor(
    readonly version: string = "0.0.0",
    readonly port: number = 3035,
    readonly host: string = "127.0.0.1",
    /** e.g. `/web-fetcher`; empty string = no base path. No trailing slash. */
    readonly basePath: string = "",
    /** Directory for the persistent Camoufox browser profiles. */
    readonly camoufoxDataDir: string = "./data/camoufox",
    /** Seconds of inactivity after which Camoufox gets unloaded. */
    readonly camoufoxIdleTimeout: number = 300,
    /** If false, urls pointing to localhost, private networks etc. are rejected (SSRF protection). */
    readonly allowLocalAddresses: boolean = false,
  ) {}

}
