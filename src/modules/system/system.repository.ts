// Database access for the system module. No business rules here.
import { getPrisma } from "@/shared/db/prisma";

export interface HeartbeatRow {
  workerId: string;
  version: string;
  startedAt: Date;
  lastBeatAt: Date;
}

export interface SystemRepository {
  /** Resolves when the database answers; rejects otherwise. */
  pingDatabase(): Promise<void>;
  upsertHeartbeat(row: HeartbeatRow): Promise<void>;
  /** The most recent heartbeat of any worker, or null if none was ever written. */
  latestHeartbeat(): Promise<Pick<HeartbeatRow, "lastBeatAt"> | null>;
}

export const systemRepository: SystemRepository = {
  async pingDatabase() {
    await getPrisma().$queryRaw`SELECT 1`;
  },

  async upsertHeartbeat({ workerId, version, startedAt, lastBeatAt }) {
    await getPrisma().systemWorkerHeartbeat.upsert({
      where: { workerId },
      create: { workerId, version, startedAt, lastBeatAt },
      update: { version, lastBeatAt },
    });
  },

  latestHeartbeat() {
    return getPrisma().systemWorkerHeartbeat.findFirst({
      orderBy: { lastBeatAt: "desc" },
      select: { lastBeatAt: true },
    });
  },
};
