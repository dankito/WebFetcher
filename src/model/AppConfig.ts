export class AppConfig {

  constructor(
    readonly version: string = "0.0.0",
    readonly port: number = 3035,
    readonly host: string = "127.0.0.1",
    /** e.g. `/web-fetcher`; empty string = no base path. No trailing slash. */
    readonly basePath: string = "",
    /** Directory for the persistent Camoufox browser profile. */
    readonly camoufoxDataDir: string = "./data/camoufox",
    /** Seconds after the last use after which Camoufox gets unloaded. */
    readonly camoufoxUnloadTimeout: number = 300,
  ) { }

}
