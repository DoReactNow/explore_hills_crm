// Prisma 7 configuration. The connection URL comes from the environment: npm scripts load
// the right env file with dotenv-cli, and containers set it directly. `prisma generate`
// does not need it, so a missing value is left empty here and reported by the command
// that actually connects.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
