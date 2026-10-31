// The s3 driver against a real S3-compatible server (P7-DRIVER-05). It needs one running, so it runs
// when TEST_S3_ENDPOINT is set: see `npm run test:contract:s3` in local_setup.md.
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, it } from "vitest";
import { createS3Storage } from "../drivers/s3";
import { runStorageContract } from "./storageContract";

const endpoint = process.env.TEST_S3_ENDPOINT;
const credentials = {
  accessKeyId: process.env.TEST_S3_ACCESS_KEY ?? "",
  secretAccessKey: process.env.TEST_S3_SECRET_KEY ?? "",
};

if (endpoint) {
  runStorageContract("s3", async () => {
    const bucket = `contract-${Math.floor(performance.now())}`;
    const client = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    return {
      storage: createS3Storage({
        endpoint,
        region: "us-east-1",
        bucket,
        forcePathStyle: true,
        ...credentials,
      }),
      cleanup: async () => undefined,
    };
  });
} else {
  describe("FileStorage contract: s3", () => {
    it.skip("needs TEST_S3_ENDPOINT", () => undefined);
  });
}
