// The injectable source of "now" (Decision 6). Services take a Clock so tests can freeze time.
import { Duration, type DurationLike } from "luxon";
import { parseInstant } from "./instants";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface TestClock extends Clock {
  /** Moves the frozen time forward (or back, with negative values). */
  advance(by: DurationLike): void;
  /** Jumps to an ISO-8601 instant or a Date. */
  set(to: string | Date): void;
}

/** A frozen clock for tests. It never moves unless the test moves it. */
export function createTestClock(start: string | Date): TestClock {
  let current = typeof start === "string" ? parseInstant(start).getTime() : start.getTime();
  return {
    now: () => new Date(current),
    advance: (by) => {
      current += Duration.fromDurationLike(by).toMillis();
    },
    set: (to) => {
      current = typeof to === "string" ? parseInstant(to).getTime() : to.getTime();
    },
  };
}
