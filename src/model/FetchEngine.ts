/**
 * Available fetch engines. Extend this enum (and register a matching Fetcher in index.ts) to add more engines.
 * The default order of the engines is defined in index.ts.
 */
export enum FetchEngine {
  Impit = "Impit",
  Camoufox = "Camoufox",
}
