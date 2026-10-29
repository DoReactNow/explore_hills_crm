// W-014: the local driver passes the shared contract against the test storage folder (storage/test).
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getEnv } from "@/shared/config/env";
import { createLocalStorage } from "../drivers/local";
import { runStorageContract } from "./storageContract";

runStorageContract("local", async () => {
  const root = join(getEnv().STORAGE_LOCAL_DIR!, "contract");
  return { storage: createLocalStorage({ root }), cleanup: () => rm(root, { recursive: true, force: true }) };
});
