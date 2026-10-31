// This module owns no tables; it only opens the transaction its steps share.
import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";

export const privacyTransaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
  getPrisma().$transaction(work);
