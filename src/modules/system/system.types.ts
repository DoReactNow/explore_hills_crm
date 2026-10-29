export const DATABASE_STATES = ["up", "down"] as const;
export type DatabaseState = (typeof DATABASE_STATES)[number];
