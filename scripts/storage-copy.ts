// Copies every stored recording to another storage: npm run storage:copy -- <.env file of the target>.
// Safe to run twice, and to stop midway.
import { parse } from "dotenv";
import { readFileSync } from "node:fs";
import { getPrisma } from "@/shared/db/prisma";
import {
  copyStorage,
  createFileStorage,
  getFileStorage,
  type StorageConfig,
} from "@/shared/storage";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Please name the env file that describes the target storage.");
  const target = createFileStorage(parse(readFileSync(file)) as unknown as StorageConfig);
  const prisma = getPrisma();
  const rows = await prisma.telephonyRecording.findMany({
    where: { status: "STORED", storageKey: { not: null } },
    select: { storageKey: true, contentType: true, sizeBytes: true },
  });
  const result = await copyStorage(
    getFileStorage(),
    target,
    rows.map((row) => ({
      key: row.storageKey as string,
      contentType: row.contentType ?? "application/octet-stream",
      sizeBytes: row.sizeBytes,
    })),
  );
  console.log(
    `Copied ${result.copied}, already there ${result.skipped}, failed ${result.failed.length}.`,
  );
  for (const key of result.failed) console.log(`  failed: ${key}`);
  await prisma.$disconnect();
  if (result.failed.length > 0) process.exitCode = 1;
}

void main();
