import type { FetchEngine } from "../../model/FetchEngine"
import type { FetchRequestParams } from "../../model/FetchRequestParams"
import type { FetchResponse } from "../../model/FetchResponse"

/** An engine that can fetch an url. Implementations are registered in index.ts. */
export interface FetchStrategy {
  readonly engine: FetchEngine

  /** False for plain HTTP clients. Such engines get skipped if JS execution is required. */
  readonly executesJavaScript: boolean

  /** Fetches the url. Throws a FetchError if it fails. Does NOT check status code, JS walls nor sanitizes. */
  fetch(params: FetchRequestParams): Promise<FetchResponse>
}
