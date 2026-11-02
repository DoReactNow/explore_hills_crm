// P11-SEC-05: after `npm run build`, nothing sent to browsers may hold a secret or a server-only name.
// Values come from the env file given, so a real secret would be caught if a build ever saw one.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";

const SECRET_NAMES = /SECRET|PASSWORD|_KEY|DATABASE_URL|SMTP_URL/;
const NAMES = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "CREDENTIALS_ENCRYPTION_KEY",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "VAPID_PRIVATE_KEY",
  "SMTP_URL",
  "passwordHash",
];

const env = parse(readFileSync(process.argv[2] ?? ".env.test"));
const values = Object.entries(env)
  .filter(
    ([name, value]) =>
      SECRET_NAMES.test(name) && !name.startsWith("VAPID_PUBLIC") && value.length >= 8,
  )
  .map(([name, value]) => [name, value]);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const files = [...walk(".next/static"), ...walk("public")];
const problems = [];
for (const file of files) {
  const text = readFileSync(file, "latin1");
  for (const name of NAMES) if (text.includes(name)) problems.push(`${file} names ${name}`);
  for (const [name, value] of values)
    if (text.includes(value)) problems.push(`${file} holds ${name}`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`[check-built-output] ${files.length} files clean of ${values.length} secret values`);
