// Copies files between storages when moving to another driver (Decision 26). Files already there with
// the same size are skipped, so it can stop midway and run again.
import type { FileStorage } from "./fileStorage";

export interface CopyResult {
  copied: number;
  skipped: number;
  failed: string[];
}

export async function copyStorage(
  from: FileStorage,
  to: FileStorage,
  files: ReadonlyArray<{ key: string; contentType: string; sizeBytes: number | null }>,
): Promise<CopyResult> {
  const result: CopyResult = { copied: 0, skipped: 0, failed: [] };
  for (const file of files) {
    try {
      const there = await to.get(file.key);
      if (there) {
        there.body.destroy();
        if (file.sizeBytes === null || there.sizeBytes === file.sizeBytes) {
          result.skipped += 1;
          continue;
        }
      }
      const source = await from.get(file.key);
      if (!source) {
        result.failed.push(file.key);
        continue;
      }
      await to.put(file.key, source.body, file.contentType);
      result.copied += 1;
    } catch {
      // One bad file doesn't stop the rest: running it again picks this one up.
      result.failed.push(file.key);
    }
  }
  return result;
}
