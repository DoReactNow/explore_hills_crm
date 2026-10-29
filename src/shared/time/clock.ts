// The injectable source of "now" (Decision 6). Services take a Clock so tests can freeze time.
// W-006 builds the full time module around it.
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
