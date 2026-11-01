// W-010: the Docker setup stays in step with the rest of the repo.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");
const nodeMajor = read(".nvmrc").trim();

describe("Docker files", () => {
  it.each(["docker/Dockerfile.local", "docker/Dockerfile.prod"])(
    "%s defaults to the .nvmrc Node version",
    (file) => {
      expect(read(file)).toMatch(new RegExp(`^ARG NODE_VERSION=${nodeMajor}$`, "m"));
    },
  );

  it.each(["docker/docker-compose.local.yml", "docker/docker-compose.prod.yml"])(
    "%s uses service names, never fixed container IPs (Decision 29)",
    (file) => {
      expect(read(file)).not.toMatch(/ipv4_address|ipv6_address|\bipam\b/);
    },
  );

  it("keeps secrets and local data out of the build context", () => {
    const ignored = read(".dockerignore")
      .split("\n")
      .map((line) => line.trim());
    for (const entry of [
      "node_modules",
      ".next",
      "dist",
      ".env*",
      "!.env*.example",
      "prisma/private",
      "storage",
      ".git",
    ]) {
      expect(ignored, entry).toContain(entry);
    }
  });

  it("runs the production app and worker as the non-root node user", () => {
    const prod = read("docker/Dockerfile.prod");
    for (const stage of ["runner", "worker"]) {
      const body =
        prod.split(new RegExp(`^FROM .* AS ${stage}$`, "m"))[1]?.split(/^FROM /m)[0] ?? "";
      expect(body, stage).toMatch(/^USER node$/m);
    }
  });

  it("removes from the worker image only what the worker's code doesn't import", () => {
    const removed = [
      ...read("docker/Dockerfile.prod").matchAll(/node_modules\/((?:@[^/\s]+)|[^/\s]+)/g),
    ].map((match) => match[1]);
    const workerFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory())
          return name === "__tests__" || name === "ui" ? [] : workerFiles(path);
        return /\.ts$/.test(name) ? [path] : [];
      });
    const sources = [
      ...workerFiles("src/worker"),
      ...workerFiles("src/modules"),
      ...workerFiles("src/shared"),
    ].filter((file) => !/\.controller\.ts$/.test(file));
    for (const file of sources) {
      const text = read(file);
      if (text.startsWith('"use client"')) continue; // browser code, never in the worker's bundle
      for (const name of removed) {
        expect(text, `${file} imports ${name}`).not.toMatch(new RegExp(`from "${name}(/|")`));
      }
    }
  });
});
