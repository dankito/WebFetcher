import type { FetchEngine } from "./FetchEngine"

export enum EngineFailureKind {
  Timeout = "Timeout",
  Network = "Network",
  HttpStatus = "HttpStatus",
  JsWall = "JsWall",
  Other = "Other",
}

/** Result of an engine (Fetcher) that did not deliver a usable response. Returned, not thrown. */
export class EngineFailure {

  constructor(
    readonly engine: FetchEngine,
    readonly kind: EngineFailureKind,
    readonly message: string,
    readonly statusCode?: number,
  ) {}

}