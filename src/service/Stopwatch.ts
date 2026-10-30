export class Stopwatch {

  private readonly startedAt = performance.now()

  static start(): Stopwatch {
    return new Stopwatch()
  }

  /** Elapsed milliseconds since start, rounded. */
  get elapsedMs(): number {
    return Math.round(performance.now() - this.startedAt)
  }

}