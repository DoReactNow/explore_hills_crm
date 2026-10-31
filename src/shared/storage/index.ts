// File storage (Decision 26). Use getFileStorage(); never import a driver directly.
export type { FileStorage, StoredFile } from "./fileStorage";
export { assertStorageKey, buildKey, STORAGE_AREAS, type KeyParts, type StorageArea } from "./keys";
export { createFileStorage, getFileStorage, type StorageConfig } from "./registry";
export { copyStorage } from "./copy";
