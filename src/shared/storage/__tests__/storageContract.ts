// The behaviour every FileStorage driver must share (Decision 26). Each driver's test calls
// runStorageContract() with a factory; the s3 driver (Phase 7) reuses this suite unchanged.
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FileStorage } from "../fileStorage";

const MB = 1024 * 1024;

async function readAll(body: Readable): Promise<{ bytes: Buffer; chunks: number; largestChunk: number }> {
  const parts: Buffer[] = [];
  let largestChunk = 0;
  for await (const chunk of body) {
    const buffer = Buffer.from(chunk as Uint8Array);
    parts.push(buffer);
    largestChunk = Math.max(largestChunk, buffer.length);
  }
  return { bytes: Buffer.concat(parts), chunks: parts.length, largestChunk };
}

/** A 5 MB stream produced lazily, 64 KB at a time; the test never holds it as one buffer. */
function lazyFiveMegabytes(): { stream: Readable; sha256: () => string } {
  const hash = createHash("sha256");
  const chunk = 64 * 1024;
  let sent = 0;
  const stream = new Readable({
    read() {
      if (sent >= 5 * MB) return this.push(null);
      const piece = Buffer.alloc(chunk, sent / chunk);
      hash.update(piece);
      sent += chunk;
      this.push(piece);
    },
  });
  return { stream, sha256: () => hash.digest("hex") };
}

export function runStorageContract(
  driverName: string,
  setup: () => Promise<{ storage: FileStorage; cleanup: () => Promise<void> }>,
): void {
  describe(`FileStorage contract: ${driverName}`, () => {
    let storage: FileStorage;
    let cleanup: () => Promise<void>;
    const key = (name: string) => `contract/${randomUUID()}/${name}`;

    beforeAll(async () => {
      ({ storage, cleanup } = await setup());
    });
    afterAll(() => cleanup());

    it("returns identical bytes after put then get, with size and checksum", async () => {
      const k = key("hello.txt");
      const bytes = Buffer.from("Kashmir, December, 4 people");
      const stored = await storage.put(k, bytes, "text/plain");
      expect(stored).toEqual({
        sizeBytes: bytes.length,
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      });
      const file = await storage.get(k);
      expect(file?.sizeBytes).toBe(bytes.length);
      expect((await readAll(file!.body)).bytes.equals(bytes)).toBe(true);
    });

    it("reports exists true after put and false after delete", async () => {
      const k = key("a.bin");
      expect(await storage.exists(k)).toBe(false);
      await storage.put(k, Buffer.from([1, 2, 3]), "application/octet-stream");
      expect(await storage.exists(k)).toBe(true);
      await storage.delete(k);
      expect(await storage.exists(k)).toBe(false);
      expect(await storage.get(k)).toBeNull();
    });

    it("treats deleting a missing key as a no-op", async () => {
      await expect(storage.delete(key("never-written.bin"))).resolves.toBeUndefined();
    });

    it("overwrites an existing key", async () => {
      const k = key("over.txt");
      await storage.put(k, Buffer.from("first"), "text/plain");
      await storage.put(k, Buffer.from("second"), "text/plain");
      expect((await readAll((await storage.get(k))!.body)).bytes.toString()).toBe("second");
    });

    it("streams a 5 MB file in and out without one 5 MB buffer", async () => {
      const k = key("large.bin");
      const source = lazyFiveMegabytes();
      const stored = await storage.put(k, source.stream, "application/octet-stream");
      expect(stored.sizeBytes).toBe(5 * MB);
      expect(stored.checksumSha256).toBe(source.sha256());

      const out = await readAll((await storage.get(k))!.body);
      expect(out.bytes.length).toBe(5 * MB);
      expect(createHash("sha256").update(out.bytes).digest("hex")).toBe(stored.checksumSha256);
      expect(out.chunks).toBeGreaterThan(1);
      expect(out.largestChunk).toBeLessThanOrEqual(MB);
    });

    it.each(["../escape.txt", "a/../../escape.txt", "/absolute.txt", "back\\slash.txt", "a//b.txt", "", "a/.hidden"])(
      "rejects the unsafe key %j",
      async (bad) => {
        await expect(storage.put(bad, Buffer.from("x"), "text/plain")).rejects.toThrow(/storage key/i);
        await expect(storage.get(bad)).rejects.toThrow(/storage key/i);
        await expect(storage.exists(bad)).rejects.toThrow(/storage key/i);
        await expect(storage.delete(bad)).rejects.toThrow(/storage key/i);
      },
    );

    it("returns a temporary URL or null (null means: stream it through the app)", async () => {
      const k = key("signed.txt");
      await storage.put(k, Buffer.from("x"), "text/plain");
      const url = await storage.getTemporaryUrl(k, 300);
      if (url !== null) expect(() => new URL(url)).not.toThrow();
    });
  });
}
