// Password hashing and the one strength rule used by seeds, user creation and password changes
// (Decisions 40, 46, 49). Hashes and passwords are never logged or returned.
import { randomBytes } from "node:crypto";
import { type Algorithm, hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { AppError } from "@/shared/errors";

export const MAX_PASSWORD_BYTES = 1024;
const MIN_PASSWORD_LENGTH = 12;
const MIN_CHARACTER_CLASSES = 3;
const MIN_PERSONAL_PART_LENGTH = 3;
const MAX_CONCURRENT_HASHES = 4;

// OWASP's minimum for argon2id: 19 MiB, 2 iterations, 1 thread.
const ARGON2_OPTIONS = {
  // The package types this as a const enum, which isolatedModules cannot read; a test checks the prefix.
  algorithm: 2 as Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const PLACEHOLDER = /change-me/i;
const COMMON_WORDS = /password|explorehills|qwerty|123456/i;
const CHARACTER_CLASSES = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/];

const STRENGTH_MESSAGE =
  "Use at least 12 characters with three of: lowercase, uppercase, digits and symbols. Avoid common words.";
const TOO_LONG_MESSAGE = "That password is too long. Please use a shorter one.";
const PERSONAL_MESSAGE = "Your password can't contain your name or email.";

export type PasswordStrength = { ok: true } | { ok: false; message: string };

export interface PasswordOwner {
  email?: string;
  name?: string;
}

const isTooLong = (password: string): boolean =>
  Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES;

function personalParts({ email, name }: PasswordOwner): string[] {
  const whole = [email, email?.split("@")[0], name];
  const nameParts = name?.split(/\s+/) ?? [];
  return [...whole, ...nameParts]
    .map((part) => part?.trim().toLowerCase() ?? "")
    .filter((part) => part.length >= MIN_PERSONAL_PART_LENGTH);
}

export function checkPasswordStrength(
  password: string,
  owner: PasswordOwner = {},
): PasswordStrength {
  if (isTooLong(password)) return { ok: false, message: TOO_LONG_MESSAGE };

  const classes = CHARACTER_CLASSES.filter((pattern) => pattern.test(password)).length;
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    classes < MIN_CHARACTER_CLASSES ||
    PLACEHOLDER.test(password) ||
    COMMON_WORDS.test(password)
  ) {
    return { ok: false, message: STRENGTH_MESSAGE };
  }

  const lowered = password.toLowerCase();
  if (personalParts(owner).some((part) => lowered.includes(part))) {
    return { ok: false, message: PERSONAL_MESSAGE };
  }
  return { ok: true };
}

export function assertPasswordStrength(password: string, owner?: PasswordOwner): void {
  const result = checkPasswordStrength(password, owner);
  if (!result.ok) {
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "password", message: result.message }],
    });
  }
}

/** The argon2 calls, injectable so tests can count them. */
export interface PasswordPrimitives {
  hash(password: string, options: typeof ARGON2_OPTIONS): Promise<string>;
  verify(hash: string, password: string, options: typeof ARGON2_OPTIONS): Promise<boolean>;
}

/** Runs at most `max` tasks at once, in order; the rest wait for a free slot. */
function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await task();
    } finally {
      // A waiter takes over this slot, so `active` only drops when nobody is waiting.
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

export function createPasswordHasher(
  primitives: PasswordPrimitives = { hash: argonHash, verify: argonVerify },
  { maxConcurrent = MAX_CONCURRENT_HASHES }: { maxConcurrent?: number } = {},
) {
  const limit = createLimiter(maxConcurrent);
  let dummyHash: Promise<string> | undefined;

  const rawHash = (password: string) =>
    limit(() => primitives.hash(password.normalize("NFC"), ARGON2_OPTIONS));

  async function rawVerify(stored: string, password: string): Promise<boolean> {
    try {
      return await limit(() =>
        primitives.verify(stored, password.normalize("NFC"), ARGON2_OPTIONS),
      );
    } catch {
      // A malformed stored hash is a failed check, never a server error (P1-PASS-04).
      return false;
    }
  }

  return {
    async hashPassword(password: string): Promise<string> {
      if (isTooLong(password)) {
        throw new AppError("VALIDATION_FAILED", {
          fieldErrors: [{ field: "password", message: TOO_LONG_MESSAGE }],
        });
      }
      return rawHash(password);
    },

    /**
     * `stored` is null when the user does not exist: a dummy hash is still verified, so the
     * response time does not reveal which accounts exist.
     */
    async verifyPassword(password: string, stored: string | null): Promise<boolean> {
      if (isTooLong(password)) return false;
      if (stored !== null) return rawVerify(stored, password);
      dummyHash ??= rawHash(randomBytes(32).toString("hex"));
      await rawVerify(await dummyHash, password);
      return false;
    },
  };
}

const defaultHasher = createPasswordHasher();

export const hashPassword = defaultHasher.hashPassword;
export const verifyPassword = defaultHasher.verifyPassword;
