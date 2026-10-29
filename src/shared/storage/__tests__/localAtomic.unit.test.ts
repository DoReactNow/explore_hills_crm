// A crash during a write never leaves a half-written file under the final key.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalStorage } from "../drivers/local";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eh-storage-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

/** Sends 1 MB, then fails, like a download that dies halfway. */
function failingHalfway(): Readable {
  let sent = false;
  return new Readable({
    read() {
      if (!sent) {
        sent = true;
        this.push(Buffer.alloc(1024 * 1024, 7));
      } else {
        this.destroy(new Error("connection reset"));
      }
    },
  });
}

async function filesUnder(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

describe("local driver: atomic writes", () => {
  it("leaves nothing under the final key, and no temporary file, when the source fails", async () => {
    const storage = createLocalStorage({ root });
    await expect(storage.put("recordings/2027/01/a.mp3", failingHalfway(), "audio/mpeg")).rejects.toThrow(/reset/);
    expect(await storage.exists("recordings/2027/01/a.mp3")).toBe(false);
    expect(await filesUnder(root)).toEqual([]);
  });

  it("keeps the previous file intact when an overwrite fails", async () => {
    const storage = createLocalStorage({ root });
    await storage.put("recordings/2027/01/b.mp3", Buffer.from("good"), "audio/mpeg");
    await expect(storage.put("recordings/2027/01/b.mp3", failingHalfway(), "audio/mpeg")).rejects.toThrow();
    const file = await storage.get("recordings/2027/01/b.mp3");
    const chunks: Buffer[] = [];
    for await (const chunk of file!.body) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("good");
    expect(await filesUnder(root)).toEqual(["b.mp3"]);
  });

  it("never resolves a key outside its root folder", async () => {
    const storage = createLocalStorage({ root });
    await expect(storage.put("../outside.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(/storage key/i);
  });
});
