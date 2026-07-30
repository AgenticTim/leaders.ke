// One-off LOCAL importer for hand-supplied portraits dropped in ../backfills.
// Same processing as import-photos.ts (top-anchored square -> 320px JPEG <= ~50 KB
// into static/leaders/<slug>.jpg, users.photoUrl updated), but the source is a
// local file matched to a DB slug by an explicit map here rather than a scrape.
// Overwrites an existing photo on purpose — these are deliberate replacements.
//
//   bun run scripts/backfill-photos.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import sharp from 'sharp';
import { users } from '../src/lib/server/db/schema';

const ROOT = join(import.meta.dir, '..');
const BACKFILL_DIR = join(ROOT, '..', 'backfills');
const OUT_DIR = join(ROOT, 'static', 'leaders');
const TARGET_BYTES = 50 * 1024;
const SIZE = 320;

// Source filename in ../backfills -> the DB slug it belongs to. example-leader.png
// is a placeholder and deliberately absent.
const FILE_TO_SLUG: Record<string, string> = {
	'Peter Gatirau Munya.png': 'peter-gatirau-munya',
	'kiraitu-murungi.jpeg': 'kiraitu-murungi',
	'mwai-kibaki.png': 'emilio-mwai-kibaki'
};

/** Center-cropped square (horizontal), top-anchored vertically -> 320px -> JPEG
 * stepped down to <= ~50 KB, matching import-photos.ts. */
async function processPhoto(original: Buffer): Promise<Buffer> {
	const meta = await sharp(original).metadata();
	const side = Math.min(meta.width ?? SIZE, meta.height ?? SIZE);
	const squared = sharp(original)
		.extract({ left: Math.floor(((meta.width ?? side) - side) / 2), top: 0, width: side, height: side })
		.resize(SIZE, SIZE);
	for (let quality = 82; quality >= 40; quality -= 7) {
		const out = await squared.jpeg({ quality, mozjpeg: true }).toBuffer();
		if (out.length <= TARGET_BYTES) return out;
	}
	return sharp(await squared.toBuffer()).resize(256, 256).jpeg({ quality: 60, mozjpeg: true }).toBuffer();
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

mkdirSync(OUT_DIR, { recursive: true });

let done = 0;
for (const [file, slug] of Object.entries(FILE_TO_SLUG)) {
	const srcPath = join(BACKFILL_DIR, file);
	if (!existsSync(srcPath)) {
		console.warn(`[backfill] ${file}: missing in ../backfills — skipped`);
		continue;
	}
	const [row] = await db.select({ id: users.id }).from(users).where(eq(users.slug, slug));
	if (!row) {
		console.warn(`[backfill] ${slug}: no user with that slug — skipped`);
		continue;
	}
	const out = await processPhoto(readFileSync(srcPath));
	writeFileSync(join(OUT_DIR, `${slug}.jpg`), out);
	await db.update(users).set({ photoUrl: `/leaders/${slug}.jpg` }).where(eq(users.id, row.id));
	console.log(`[backfill] ${slug}: wrote static/leaders/${slug}.jpg (${(out.length / 1024).toFixed(0)} KB), photoUrl set`);
	done++;
}

console.log(`[backfill] done: ${done} processed`);
await client.end();
