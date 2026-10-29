// Database access for the system module. No business rules here.
import { getPrisma } from "@/shared/db/prisma";

export interface SystemRepository {
  /** Resolves when the database answers; rejects otherwise. */
  pingDatabase(): Promise<void>;
}

export const systemRepository: SystemRepository = {
  async pingDatabase() {
    await getPrisma().$queryRaw`SELECT 1`;
  },
};
