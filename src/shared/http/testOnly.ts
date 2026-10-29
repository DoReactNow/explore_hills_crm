// Test-only routes and pages call these first: outside APP_ENV=test they answer 404,
// so they are unreachable in development and production (W-004, W-008).
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors/AppError";

export function isTestEnvironment(): boolean {
  return getEnv().APP_ENV === "test";
}

export function assertTestEnvironment(): void {
  if (!isTestEnvironment()) throw new AppError("NOT_FOUND");
}
