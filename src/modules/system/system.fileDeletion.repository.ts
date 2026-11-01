// Database access for the list of files waiting to be deleted. No business rules here.
import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";

export type FileDeletionTx = Prisma.TransactionClient;

export const fileDeletionRepository = {
  async enqueue(
    tx: FileDeletionTx,
    keys: readonly string[],
    reason: string,
    at: Date,
  ): Promise<void> {
    if (keys.length === 0) return;
    await tx.systemFileDeletion.createMany({
      data: keys.map((storageKey) => ({ storageKey, reason, createdAt: at })),
      skipDuplicates: true,
    });
  },

  /** Oldest attempt first, so one stubborn file can't hold up the rest. */
  next: (take: number) =>
    getPrisma().systemFileDeletion.findMany({
      orderBy: { updatedAt: "asc" },
      take,
      select: { id: true, storageKey: true, attempts: true },
    }),

  async done(id: string): Promise<void> {
    await getPrisma().systemFileDeletion.delete({ where: { id } });
  },

  async failed(id: string, message: string): Promise<void> {
    await getPrisma().systemFileDeletion.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastError: message },
    });
  },

  count: () => getPrisma().systemFileDeletion.count(),
};

export type FileDeletionRepository = typeof fileDeletionRepository;
