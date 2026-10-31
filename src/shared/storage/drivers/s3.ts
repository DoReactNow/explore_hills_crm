// Any S3-compatible service: AWS S3, Cloudflare R2, Backblaze B2, Wasabi, or self-hosted (Decision 26).
// S3 uploads replace a key all at once, so a reader never sees a partial file.
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FileStorage, StoredFile } from "../fileStorage";
import { assertStorageKey } from "../keys";

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const isMissing = (error: unknown) => {
  const name = (error as { name?: string }).name;
  return name === "NoSuchKey" || name === "NotFound";
};

/** Reads the upload once to size and check it. Recordings are small: about 180 KB a minute. */
async function collect(body: Readable | Uint8Array): Promise<Buffer> {
  if (!(body instanceof Readable)) return Buffer.from(body);
  const parts: Buffer[] = [];
  for await (const chunk of body) parts.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(parts);
}

export function createS3Storage(options: S3StorageOptions): FileStorage {
  const { bucket } = options;
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: options.forcePathStyle,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });

  return {
    driver: "s3",

    async put(key, body, contentType): Promise<StoredFile> {
      assertStorageKey(key);
      const bytes = await collect(body);
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }),
      );
      return {
        sizeBytes: bytes.length,
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },

    async get(key) {
      assertStorageKey(key);
      try {
        const found = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return { body: found.Body as Readable, sizeBytes: found.ContentLength ?? 0 };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async delete(key) {
      assertStorageKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async exists(key) {
      assertStorageKey(key);
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },

    getTemporaryUrl(key, ttlSeconds) {
      assertStorageKey(key);
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: ttlSeconds,
      });
    },
  };
}
