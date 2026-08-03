// Rasterizes src/lib/assets/favicon.svg into the static/ fallback set browsers
// and OSes still expect outside SVG <link rel="icon"> support: a multi-size
// .ico (PNG-in-ICO, supported since Vista — no legacy BMP frames needed),
// discrete 16/32px PNGs, and a 180px apple-touch-icon. Rerun after editing the
// source SVG.
//
//   bun run scripts/build-favicon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const svg = readFileSync(join(import.meta.dirname, '../src/lib/assets/favicon.svg'));
const staticDir = join(import.meta.dirname, '../static');

async function pngBuffer(size) {
	return sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
}

/** Minimal ICO container: header + directory entries + embedded PNG frames. */
function buildIco(buffers, sizes) {
	const n = buffers.length;
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type: icon
	header.writeUInt16LE(n, 4); // frame count

	let offset = 6 + n * 16;
	const entries = sizes.map((size, i) => {
		const buf = buffers[i];
		const entry = Buffer.alloc(16);
		entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256px)
		entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
		entry.writeUInt16LE(1, 4); // color planes
		entry.writeUInt16LE(32, 6); // bits per pixel
		entry.writeUInt32LE(buf.length, 8);
		entry.writeUInt32LE(offset, 12);
		offset += buf.length;
		return entry;
	});
	return Buffer.concat([header, ...entries, ...buffers]);
}

const sizes = [16, 32, 48];
const buffers = await Promise.all(sizes.map(pngBuffer));
writeFileSync(join(staticDir, 'favicon.ico'), buildIco(buffers, sizes));
writeFileSync(join(staticDir, 'favicon-16x16.png'), buffers[0]);
writeFileSync(join(staticDir, 'favicon-32x32.png'), buffers[1]);
writeFileSync(join(staticDir, 'apple-touch-icon.png'), await pngBuffer(180));

console.log('favicon.ico, favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png written to static/');
