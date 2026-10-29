// `npm run guard:files`: fails when git tracks a secret or private file (Decisions 11 and 15):
// anything under prisma/private/, any real .env file (only the three *.example files are allowed),
// or local storage (recordings and uploads).
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const ENV_EXAMPLES = new Set([".env.example", ".env.test.example", ".env.production.example"]);

/** @param {string[]} paths repository-relative paths */
export function findForbiddenFiles(paths) {
  return paths.filter((path) => {
    const name = basename(path);
    const isRealEnv = /^\.env(\..+)?$/.test(name) && !ENV_EXAMPLES.has(name);
    return path.startsWith("prisma/private/") || path.startsWith("storage/") || isRealEnv;
  });
}

function main() {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const forbidden = findForbiddenFiles(tracked);
  if (forbidden.length > 0) {
    console.error("[guard:files] these files must never be committed:");
    for (const path of forbidden) console.error(`  - ${path}`);
    console.error("Remove them from git (git rm --cached <file>) and keep them local.");
    process.exit(1);
  }
  console.log(`[guard:files] ok (${tracked.length} tracked files checked)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
