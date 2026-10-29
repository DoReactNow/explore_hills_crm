// Storage keys are ours and never contain personal data (Decision 26), for example
// "recordings/2026/12/<callId>.mp3". The same key works on every driver.

export const STORAGE_AREAS = ["recordings", "uploads", "exports"] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];

const MAX_KEY_LENGTH = 512;
/** ASCII letters, digits, ".", "_" and "-"; a segment may not start with "." (no "..", no hidden files). */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Throws unless `key` is a relative path of safe segments that cannot leave the storage root. */
export function assertStorageKey(key: string): void {
  const valid =
    key.length > 0 && key.length <= MAX_KEY_LENGTH && key.split("/").every((segment) => SEGMENT.test(segment));
  if (!valid) throw new Error(`Invalid storage key ${JSON.stringify(key.slice(0, 80))}`);
}

export interface KeyParts {
  area: StorageArea;
  /** Business month the file belongs to, "YYYY-MM". */
  yearMonth: string;
  /** The owning record's UUID, never a name, phone number or email. */
  id: string;
  extension: string;
}

export function buildKey({ area, yearMonth, id, extension }: KeyParts): string {
  if (!(STORAGE_AREAS as readonly string[]).includes(area)) throw new Error(`Unknown storage area "${area}"`);
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(yearMonth);
  if (!month) throw new Error(`Storage key month must be YYYY-MM (got "${yearMonth}")`);
  if (!UUID.test(id)) throw new Error("Storage key ID must be a UUID (keys never contain personal data)");
  if (!/^[a-z0-9]{1,8}$/.test(extension)) throw new Error(`Invalid storage key extension "${extension}"`);
  const key = `${area}/${month[1]}/${month[2]}/${id}.${extension}`;
  assertStorageKey(key);
  return key;
}
