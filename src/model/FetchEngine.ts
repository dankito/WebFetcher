/**
 * Available fetch engines / strategies. Extend this enum (and register a matching
 * FetchStrategy in index.ts) to add more engines.
 * The order of declaration is irrelevant, the default order is defined in index.ts.
 */
export enum FetchEngine {
  Impit = "impit",
  Camoufox = "camoufox",
}
