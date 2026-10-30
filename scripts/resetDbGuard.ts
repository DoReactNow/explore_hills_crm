// Decides whether db:reset may run. Only the two local env files qualify, and each must point at
// its own kind of database. Production can never be reset this way.
export interface ResetTarget {
  APP_ENV: string;
  databaseName: string;
}

export function assertResetTarget(envFile: string, { APP_ENV, databaseName }: ResetTarget): void {
  const isTestDb = databaseName.endsWith("_test");
  const allowed =
    (envFile === ".env" && APP_ENV === "development" && !isTestDb) ||
    (envFile === ".env.test" && APP_ENV === "test" && isTestDb);
  if (!allowed) {
    throw new Error(
      `Refusing to reset: ${envFile} has APP_ENV=${APP_ENV} and database "${databaseName}". Only .env (development) and .env.test (a _test database) can be reset.`,
    );
  }
}
