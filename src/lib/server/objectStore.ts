// S3-compatible object storage (Cloudflare R2 in production), with local disk as
// the fallback when it isn't configured.
//
// Uploads go to the bucket whenever STORAGE_ENDPOINT/BUCKET/keys are all set;
// otherwise they land under STORAGE_LOCAL_DIR exactly as before, so a dev
// machine with no credentials keeps working untouched.
//
// Stored URLs stay `/uploads/...` either way, and the routes under
// src/routes/uploads read back through here. The bucket is NOT public (its
// STORAGE_PUBLIC_BASE_URL is the S3 endpoint, which requires signed requests),
// and the knowledge documents are deliberately access-controlled, so serving
// through the app is what keeps those checks in force.
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';

/** True once every piece of S3 config is present. A half-filled block (an
 * endpoint but no key) falls back to disk rather than failing every upload. */
export function usingObjectStore(): boolean {
	return !!(env.STORAGE_ENDPOINT && env.STORAGE_BUCKET && env.STORAGE_ACCESS_KEY_ID && env.STORAGE_SECRET_ACCESS_KEY);
}

let client: S3Client | null = null;
function s3(): S3Client {
	// forcePathStyle: R2 addresses buckets as <endpoint>/<bucket>. Virtual-host
	// style would resolve to a subdomain that doesn't exist for a custom endpoint.
	client ??= new S3Client({
		region: env.STORAGE_REGION || 'auto',
		endpoint: env.STORAGE_ENDPOINT,
		forcePathStyle: true,
		credentials: {
			accessKeyId: env.STORAGE_ACCESS_KEY_ID!,
			secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY!
		}
	});
	return client;
}

const localRoot = () => path.join(process.cwd(), env.STORAGE_LOCAL_DIR || '.uploads');

/** Stores one object under `key` (e.g. "leaders/42/uuid.jpg"), in the bucket when
 * configured, else on local disk under the same relative path. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
	if (usingObjectStore()) {
		await s3().send(
			new PutObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key, Body: body, ContentType: contentType })
		);
		return;
	}
	const file = path.join(localRoot(), key);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, body);
}

/**
 * Reads one object back, or null when it isn't there.
 *
 * Falls through to local disk on a bucket miss so uploads written before the
 * bucket existed keep serving: the switch to R2 doesn't strand them.
 */
export async function getObject(key: string): Promise<Buffer | null> {
	if (usingObjectStore()) {
		try {
			const res = await s3().send(new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }));
			const bytes = await res.Body?.transformToByteArray();
			if (bytes) return Buffer.from(bytes);
		} catch {
			// Not in the bucket (or unreadable): try the disk copy below.
		}
	}
	try {
		return await readFile(path.join(localRoot(), key));
	} catch {
		return null;
	}
}
