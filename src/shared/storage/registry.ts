// The only file that imports a storage driver (architecture rule 8). STORAGE_DRIVER chooses it.
import { getEnv, type Env } from "@/shared/config/env";
import { createLocalStorage } from "./drivers/local";
import type { FileStorage } from "./fileStorage";

export type StorageConfig = Pick<Env, "STORAGE_DRIVER"> & { STORAGE_LOCAL_DIR?: string };

export function createFileStorage(config: StorageConfig): FileStorage {
  const driver: string = config.STORAGE_DRIVER;
  switch (driver) {
    case "local":
      if (!config.STORAGE_LOCAL_DIR) throw new Error("STORAGE_DRIVER=local needs STORAGE_LOCAL_DIR");
      return createLocalStorage({ root: config.STORAGE_LOCAL_DIR });
    case "s3":
      throw new Error("STORAGE_DRIVER=s3 is not available yet: the s3 driver arrives in Phase 7");
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${driver}"`);
  }
}

let cached: FileStorage | undefined;

/** The configured storage. Called at app and worker start, so a wrong driver fails immediately. */
export function getFileStorage(): FileStorage {
  cached ??= createFileStorage(getEnv());
  return cached;
}
