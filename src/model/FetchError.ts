import type { EngineFailure } from "./EngineFailure"

export enum FetchErrorReason {
  /** The url points to a local / private address and AppConfig.allowLocalAddresses is false. */
  ForbiddenAddress = "ForbiddenAddress",
  /** No registered engine matches the requested engines and options. */
  NoApplicableEngine = "NoApplicableEngine",
  /** All engines ran into the timeout. */
  Timeout = "Timeout",
  /** All applicable engines failed. */
  AllEnginesFailed = "AllEnginesFailed",
}

/** Result of the FetchService if no usable response could be delivered. Returned, not thrown. */
export class FetchError {

  constructor(
    readonly reason: FetchErrorReason,
    readonly message: string,
    readonly engineFailures: EngineFailure[] = [],
  ) {}

}
