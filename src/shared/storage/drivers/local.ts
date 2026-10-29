// The "local" driver: a folder on the server's disk (storage/ locally, a Docker volume on a VPS).
// Writes go to a temporary file in the same folder and are renamed into place, so a crash never
// leaves a half-written file under the final key. Only registry.ts imports this file.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FileStorage } from "../fileStorage";
import { assertStorageKey } from "../keys";

const READ_CHUNK_BYTES = 64 * 1024;

export function createLocalStorage({ root }: { root: string }): FileStorage {
  const rootDir = resolve(root);

  function pathFor(key: string): string {
    assertStorageKey(key);
    const path = resolve(rootDir, key);
    if (!path.startsWith(rootDir + sep)) throw new Error("Invalid storage key (outside the storage root)");
    return path;
  }

  async function isFile(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }

  return {
    driver: "local",

    async put(key, body) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);

      const hash = createHash("sha256");
      let sizeBytes = 0;
      const measure = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          sizeBytes += chunk.length;
          done(null, chunk);
        },
      });

      try {
        const source = body instanceof Uint8Array ? Readable.from([Buffer.from(body)]) : body;
        await pipeline(source, measure, createWriteStream(temporary, { flags: "wx" }));
        const handle = await open(temporary, "r");
        try {
          await handle.sync(); // the bytes are on disk before the file becomes visible
        } finally {
          await handle.close();
        }
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return { sizeBytes, checksumSha256: hash.digest("hex") };
    },

    async get(key) {
      const path = pathFor(key);
      if (!(await isFile(path))) return null;
      const { size } = await stat(path);
      return { body: createReadStream(path, { highWaterMark: READ_CHUNK_BYTES }), sizeBytes: size };
    },

    async delete(key) {
      await rm(pathFor(key), { force: true });
    },

    async exists(key) {
      return isFile(pathFor(key));
    },

    async getTemporaryUrl(key) {
      pathFor(key);
      return null; // no signed links on a local disk: the app streams the file after its checks
    },
  };
}
