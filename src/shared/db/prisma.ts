// The Prisma client singleton. Created on first use (never at import), so `next build` needs no
// database. Kept on globalThis so hot reload in development does not open new pools.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/shared/config/env";

const holder = globalThis as unknown as { explorehillsPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  holder.explorehillsPrisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: getEnv().DATABASE_URL }),
  });
  return holder.explorehillsPrisma;
}
