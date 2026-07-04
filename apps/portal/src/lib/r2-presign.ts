import 'server-only';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Presigned PUT uploads for the store layout video (PRD F-5 / task #6).
 *
 * The template's storage layer uses `s3mini`, which cannot presign, and its
 * /api/storage/upload route buffers the whole file through the Next.js server
 * and caps at 4MB (images). Layout videos are large (up to 2GB), so they must
 * go DIRECTLY from the browser to R2 via a short-lived presigned PUT URL.
 *
 * R2 is S3-compatible: same STORAGE_* env the template already uses, region
 * 'auto', virtual endpoint at STORAGE_ENDPOINT.
 */

/** Max accepted video size — R2 single PUT tops out well above this. */
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

/** How long a presigned upload URL stays valid. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60; // 15 minutes

let cachedClient: S3Client | null = null;

function getR2Client(): S3Client {
  if (cachedClient) {
    return cachedClient;
  }

  const endpoint = process.env.STORAGE_ENDPOINT;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 storage is not configured (STORAGE_ENDPOINT / STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY)'
    );
  }

  cachedClient = new S3Client({
    region: process.env.STORAGE_REGION || 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

function getBucket(): string {
  const bucket = process.env.STORAGE_BUCKET_NAME;
  if (!bucket) {
    throw new Error('STORAGE_BUCKET_NAME is not set');
  }
  return bucket;
}

/**
 * Strip a client-supplied filename down to a safe object-key suffix:
 * basename only, ASCII-ish, no path separators, length capped.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'video';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return cleaned || 'video';
}

/**
 * Build the canonical R2 object key for a store's layout video.
 * Prefix is `stores/{slug}/video/` so the anti-tamper check in
 * /api/store/video-complete can verify the caller owns the prefix, and so an
 * R2 lifecycle rule can target the `stores/<slug>/video/` prefix for the
 * 30-day retention described in the PRD.
 */
export function buildVideoKey(slug: string, filename: string): string {
  return `stores/${slug}/video/${Date.now()}-${sanitizeFilename(filename)}`;
}

/**
 * Presign a single PUT for `key` with the given content type.
 * The browser must send the SAME Content-Type header on the PUT.
 */
export async function presignVideoUpload(
  key: string,
  contentType: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getR2Client(), command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
  });
}
