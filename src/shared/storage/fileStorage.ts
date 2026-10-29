// The file storage interface (Decision 26). Audio and other files never go in the database: they
// are saved here, and the database keeps the key plus metadata (size, checksum, content type).
// Switching storage (local disk, any S3-compatible service) is a configuration change.
import type { Readable } from "node:stream";

export interface StoredFile {
  sizeBytes: number;
  checksumSha256: string;
}

export interface FileStorage {
  readonly driver: string;
  /** Saves a file under `key`, replacing any file already there. Never leaves a partial file. */
  put(key: string, body: Readable | Uint8Array, contentType: string): Promise<StoredFile>;
  /** Streams a file back, or null if there is none. Store the content type with the metadata. */
  get(key: string): Promise<{ body: Readable; sizeBytes: number } | null>;
  /** Deleting a missing key is a no-op. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** A short-lived link where the driver can sign one; null means the app streams the file itself. */
  getTemporaryUrl(key: string, ttlSeconds: number): Promise<string | null>;
}
