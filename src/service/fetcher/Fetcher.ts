import type { EngineFailure } from "../../model/EngineFailure"
import type { FetchEngine } from "../../model/FetchEngine"
import type { FetchRequest } from "../../model/FetchRequest"
import type { FetchResponse } from "../../model/FetchResponse"

/** Fetches urls with a specific engine. Implementations are registered in index.ts. */
export interface Fetcher {

  readonly engine: FetchEngine

  /** False for plain HTTP clients. Such engines get skipped if JS execution is required. */
  readonly executesJavaScript: boolean

  /**
   * Fetches the url. Returns an EngineFailure instead of throwing if that fails.
   * Does NOT check the status code nor JS walls and does not sanitize, that is up to the FetchService.
   */
  fetch(request: FetchRequest): Promise<FetchResponse | EngineFailure>

}