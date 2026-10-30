// Values the assignment screens and the server share.
export const ASSIGN_MODES = [
  "MANUAL",
  "ROUND_ROBIN",
  "LEAST_LOADED",
  "PRIORITY",
  "RANDOM",
] as const;
export const AUTO_MODES = ["ROUND_ROBIN", "LEAST_LOADED", "PRIORITY", "RANDOM"] as const;
export type AssignMode = (typeof ASSIGN_MODES)[number];
export type AutoMode = (typeof AUTO_MODES)[number];
export const MAX_BATCH = 2000;
export const UNDO_SECONDS = 30;
