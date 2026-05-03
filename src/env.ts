import dotenv from "dotenv";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

// Local/dev: `.env` base → optional `.nv` → `.env.local` wins (never override already-exported env).
dotenv.config({ path: ".env", override: false });
dotenv.config({ path: ".nv", override: true });
dotenv.config({ path: ".env.local", override: true });

function shouldLoadFromS3(): boolean {
  const explicit = (process.env.APP_ENV_LOAD_FROM_S3 ?? "").toLowerCase() === "true";
  if (explicit) return true;
  return (
    process.env.NODE_ENV === "production" &&
    !!process.env.APP_ENV_S3_BUCKET?.trim() &&
    !!process.env.APP_ENV_S3_KEY?.trim()
  );
}

/**
 * Production: load JSON from s3://APP_ENV_S3_BUCKET/APP_ENV_S3_KEY into process.env.
 * Format: { "SUPABASE_URL": "...", "SUPABASE_ANON_KEY": "...", ... } (string values only).
 * EB instance role must allow s3:GetObject on that object.
 */
export async function bootstrapEnv(): Promise<void> {
  if (!shouldLoadFromS3()) return;

  const bucket = process.env.APP_ENV_S3_BUCKET!.trim();
  const key = process.env.APP_ENV_S3_KEY!.trim();
  const region =
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1";

  const client = new S3Client({ region });
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await res.Body?.transformToString();
  if (body == null || body === "") {
    throw new Error(`Empty S3 env object: s3://${bucket}/${key}`);
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON in s3://${bucket}/${key}`);
  }

  let n = 0;
  for (const [k, val] of Object.entries(json)) {
    if (typeof val !== "string") continue;
    process.env[k] = val;
    n += 1;
  }

  console.log(`[env] loaded ${n} string keys from s3://${bucket}/${key}`);
}
