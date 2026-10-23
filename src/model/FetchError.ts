import type { FetchEngine } from "./FetchEngine"

export enum FetchErrorKind {
  Timeout = "timeout",
  Network = "network",
  HttpStatus = "httpStatus",
  JsWall = "jsWall",
  Unsupported = "unsupported",
  Other = "other",
}


/** Thrown by a single engine (strategy) if it fails. */
export class FetchError extends Error {

  constructor(
    message: string,
    readonly engine: FetchEngine,
    readonly kind: FetchErrorKind,
    readonly statusCode?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "FetchError"
  }

}


export class FetchAttempt {

  constructor(
    readonly engine: FetchEngine,
    readonly kind: FetchErrorKind,
    readonly message: string,
    readonly statusCode?: number,
  ) {}

}


/** Thrown by the FetchService if no engine delivered a usable response. */
export class FetchFailedError extends Error {

  constructor(
    message: string,
    readonly attempts: FetchAttempt[],
  ) {
    super(message)
    this.name = "FetchFailedError"
  }

  get isTimeout(): boolean {
    return this.attempts.length > 0 && this.attempts.every((attempt) => attempt.kind === FetchErrorKind.Timeout)
  }

}
