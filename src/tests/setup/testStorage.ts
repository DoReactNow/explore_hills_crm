// The temporary storage folder used by tests (STORAGE_LOCAL_DIR in .env.test, storage/test).
import { mkdirSync, rmSync } from "node:fs";
import { getEnv } from "@/shared/config/env";
import { assertTestStorageDir } from "./guards";

export function resetTestStorage(): string {
  const dir = getEnv().STORAGE_LOCAL_DIR;
  if (!dir) throw new Error("STORAGE_LOCAL_DIR is not set in .env.test");
  assertTestStorageDir(dir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
