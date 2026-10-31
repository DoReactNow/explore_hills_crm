// The only file that imports a storage driver (architecture rule 8). STORAGE_DRIVER chooses it.
import { getEnv, type Env } from "@/shared/config/env";
import { createLocalStorage } from "./drivers/local";
import { createS3Storage } from "./drivers/s3";
import type { FileStorage } from "./fileStorage";

export type StorageConfig = Pick<Env, "STORAGE_DRIVER"> &
  Partial<
    Pick<
      Env,
      | "STORAGE_LOCAL_DIR"
      | "STORAGE_S3_ENDPOINT"
      | "STORAGE_S3_REGION"
      | "STORAGE_S3_BUCKET"
      | "STORAGE_S3_ACCESS_KEY_ID"
      | "STORAGE_S3_SECRET_ACCESS_KEY"
      | "STORAGE_S3_FORCE_PATH_STYLE"
    >
  >;

export function createFileStorage(config: StorageConfig): FileStorage {
  const driver: string = config.STORAGE_DRIVER;
  switch (driver) {
    case "local":
      if (!config.STORAGE_LOCAL_DIR) throw new Error("STORAGE_DRIVER=local needs STORAGE_LOCAL_DIR");
      return createLocalStorage({ root: config.STORAGE_LOCAL_DIR });
    case "s3":
      return createS3Storage({
        endpoint: config.STORAGE_S3_ENDPOINT as string,
        region: config.STORAGE_S3_REGION as string,
        bucket: config.STORAGE_S3_BUCKET as string,
        accessKeyId: config.STORAGE_S3_ACCESS_KEY_ID as string,
        secretAccessKey: config.STORAGE_S3_SECRET_ACCESS_KEY as string,
        forcePathStyle: config.STORAGE_S3_FORCE_PATH_STYLE === "true",
      });
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
