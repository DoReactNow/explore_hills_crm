// P7-REC-01, -05, -07: real ffmpeg on real audio, and nothing left behind.
import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { fakeWav } from "../providers/fake/server";
import { BadRecordingError, transcodeToMp3 } from "../telephony.transcode";

describe("transcodeToMp3", () => {
  it("produces a smaller MP3 and removes its temporary files", async () => {
    const source = fakeWav(5);
    let seen = "";
    const size = await transcodeToMp3(Readable.from([source]), 24, async (path, sizeBytes) => {
      seen = path;
      const bytes = readFileSync(path);
      // An MP3 starts with an ID3 tag or a frame sync.
      expect(bytes.subarray(0, 3).toString() === "ID3" || bytes[0] === 0xff).toBe(true);
      return sizeBytes;
    });
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(source.length / 3);
    expect(existsSync(seen)).toBe(false);
  });

  it.each([
    ["empty", Buffer.alloc(0)],
    ["corrupt", Buffer.from("this is not audio at all, not even close")],
  ])("refuses a file that is %s, clearly", async (_name, bytes) => {
    await expect(
      transcodeToMp3(Readable.from([bytes]), 24, async () => "never"),
    ).rejects.toBeInstanceOf(BadRecordingError);
  });
});
