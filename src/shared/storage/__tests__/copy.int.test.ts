// storage:copy can run twice safely, and carries on past a failure (P7-DRIVER-05).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyStorage } from "../copy";
import { createLocalStorage } from "../drivers/local";

const local = () => createLocalStorage({ root: mkdtempSync(join(tmpdir(), "copy-")) });
const file = (key: string, sizeBytes: number) => ({ key, contentType: "audio/mpeg", sizeBytes });

describe("copyStorage", () => {
  it("copies once, then skips, and picks up after a failure", async () => {
    const [from, to] = [local(), local()];
    await from.put("recordings/a.mp3", Buffer.from("aaa"), "audio/mpeg");
    await from.put("recordings/b.mp3", Buffer.from("bbbb"), "audio/mpeg");
    const files = [
      file("recordings/a.mp3", 3),
      file("recordings/missing.mp3", 1),
      file("recordings/b.mp3", 4),
    ];
    expect(await copyStorage(from, to, files)).toEqual({
      copied: 2,
      skipped: 0,
      failed: ["recordings/missing.mp3"],
    });
    expect(await copyStorage(from, to, files)).toEqual({
      copied: 0,
      skipped: 2,
      failed: ["recordings/missing.mp3"],
    });
  });

  it("replaces a partial copy of the wrong size", async () => {
    const [from, to] = [local(), local()];
    await from.put("recordings/a.mp3", Buffer.from("aaa"), "audio/mpeg");
    await to.put("recordings/a.mp3", Buffer.from("a"), "audio/mpeg");
    const result = await copyStorage(from, to, [file("recordings/a.mp3", 3)]);
    expect(result.copied).toBe(1);
    expect((await to.get("recordings/a.mp3"))?.sizeBytes).toBe(3);
  });
});
