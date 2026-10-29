// Safety guards for every test helper that touches the database or the disk.
import { resolve, sep } from "node:path";

export function assertTestDatabaseUrl(url: string): void {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run: tests need a database whose name ends in _test (got "${name}").`,
    );
  }
}

export function assertTestStorageDir(dir: string): void {
  const storageRoot = resolve("storage");
  const target = resolve(dir);
  if (!target.startsWith(storageRoot + sep) || !target.endsWith(`${sep}test`)) {
    throw new Error(
      `Refusing to run: the test storage folder must be storage/test (got "${dir}").`,
    );
  }
}
