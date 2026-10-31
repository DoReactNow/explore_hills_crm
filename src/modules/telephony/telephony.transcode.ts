// Turns a provider's recording into a small mono file with ffmpeg (Decision 25). Works on temporary
// files that are always removed, so a crash leaves nothing behind in storage.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getEnv } from "@/shared/config/env";

const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
const TIMEOUT_MS = 10 * 60 * 1000;

/** The conversion itself failed, so running it again on the same file can't help. */
export class BadRecordingError extends Error {}

async function ffmpegPath(): Promise<string> {
  const override = getEnv().FFMPEG_PATH;
  if (override) return override;
  const { default: bundled } = await import("ffmpeg-static");
  if (!bundled) throw new Error("ffmpeg isn't available on this machine");
  return bundled;
}

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new BadRecordingError(`ffmpeg stopped with code ${code}`));
    });
  });
}

/** Hands the finished file to `store`, then removes everything. */
export async function transcodeToMp3<T>(
  source: Readable,
  bitrateKbps: number,
  store: (path: string, sizeBytes: number) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "recording-"));
  try {
    const input = join(dir, "source");
    const output = join(dir, "out.mp3");
    await pipeline(source, createWriteStream(input));
    const { size } = await stat(input);
    if (size === 0) throw new BadRecordingError("the recording is empty");
    if (size > MAX_SOURCE_BYTES) throw new BadRecordingError("the recording is too large");
    await run(await ffmpegPath(), [
      "-y",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-b:a",
      `${bitrateKbps}k`,
      "-f",
      "mp3",
      output,
    ]);
    const finished = await stat(output);
    if (finished.size === 0) throw new BadRecordingError("the conversion produced nothing");
    return await store(output, finished.size);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
