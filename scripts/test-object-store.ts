// Round-trips a real object through the configured bucket: put, read back,
// compare bytes, then delete. Proves the credentials, the endpoint, the bucket
// name and (on a droplet) the IP allowlist all actually work, without waiting
// for someone to attempt an upload in the UI.
//
// Must run where the credentials are allowed to connect from; an IP-restricted
// key will fail everywhere else. Mirrors objectStore.ts rather than importing it
// ($env/dynamic/private only resolves inside SvelteKit's runtime).
//
// Usage: bun run scripts/test-object-store.ts
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const { STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_REGION } = process.env;
if (!STORAGE_ENDPOINT || !STORAGE_BUCKET || !STORAGE_ACCESS_KEY_ID || !STORAGE_SECRET_ACCESS_KEY) {
	console.error('Storage is not configured: STORAGE_ENDPOINT, STORAGE_BUCKET and both keys are required.');
	process.exit(1);
}

const s3 = new S3Client({
	region: STORAGE_REGION || 'auto',
	endpoint: STORAGE_ENDPOINT,
	forcePathStyle: true,
	credentials: { accessKeyId: STORAGE_ACCESS_KEY_ID, secretAccessKey: STORAGE_SECRET_ACCESS_KEY }
});

const key = `_healthcheck/${Date.now()}.txt`;
const payload = Buffer.from(`vote.ke storage check ${new Date().toISOString()}`);
console.log(`bucket   : ${STORAGE_BUCKET}`);
console.log(`endpoint : ${STORAGE_ENDPOINT.replace(/\/\/([^.]{6})[^.]*/, '//$1…')}`);
console.log(`key      : ${key}\n`);

try {
	await s3.send(new PutObjectCommand({ Bucket: STORAGE_BUCKET, Key: key, Body: payload, ContentType: 'text/plain' }));
	console.log('PUT     ok');

	const res = await s3.send(new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
	const got = Buffer.from((await res.Body!.transformToByteArray()) as Uint8Array);
	const same = got.equals(payload);
	console.log(`GET     ok (${got.length} bytes, contents ${same ? 'match' : 'DIFFER'})`);
	if (!same) process.exit(1);

	await s3.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
	console.log('DELETE  ok\n');
	console.log('Storage is working.');
} catch (err) {
	const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
	console.error(`FAILED  ${e.name ?? 'Error'} (HTTP ${e.$metadata?.httpStatusCode ?? '?'}): ${e.message}`);
	process.exit(1);
}
