/*
 * A store-only ZIP writer: every file goes in as-is, uncompressed.
 *
 * That is the whole format minus DEFLATE, and DEFLATE is the part not worth
 * carrying here — the only thing zipped is photos, and a JPEG is already as
 * small as a general-purpose compressor will make it. What is left is three
 * fixed-layout records and a CRC-32, which is less code than a dependency's
 * import line is worth explaining.
 *
 * Layout, per the PKWARE APPNOTE: a local header and the bytes for each file,
 * then a central directory listing them all, then the end-of-central-directory
 * record that points at it. No ZIP64, so the archive tops out at 4 GiB and
 * 65,535 files — a carousel holds twenty.
 */

export interface ZipEntry {
	name: string;
	data: Uint8Array;
}

/** Bit 11 of the general-purpose flags: file names are UTF-8. */
const UTF8_NAMES = 0x0800;

/** Version 2.0: the lowest that knows about directories and stored files alike. */
const VERSION = 20;

export function zipStore(entries: ZipEntry[], date = new Date()): Uint8Array {
	const encoder = new TextEncoder();
	const { time, day } = dosDateTime(date);

	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const crc = crc32(entry.data);
		const size = entry.data.length;

		const local = new Uint8Array(30 + name.length);
		const l = new DataView(local.buffer);
		l.setUint32(0, 0x04034b50, true); // local file header signature
		l.setUint16(4, VERSION, true);
		l.setUint16(6, UTF8_NAMES, true);
		l.setUint16(8, 0, true); // method: stored
		l.setUint16(10, time, true);
		l.setUint16(12, day, true);
		l.setUint32(14, crc, true);
		l.setUint32(18, size, true); // compressed size
		l.setUint32(22, size, true); // uncompressed size
		l.setUint16(26, name.length, true);
		l.setUint16(28, 0, true); // extra field length
		local.set(name, 30);

		const central = new Uint8Array(46 + name.length);
		const c = new DataView(central.buffer);
		c.setUint32(0, 0x02014b50, true); // central directory header signature
		c.setUint16(4, VERSION, true); // version made by
		c.setUint16(6, VERSION, true); // version needed
		c.setUint16(8, UTF8_NAMES, true);
		c.setUint16(10, 0, true);
		c.setUint16(12, time, true);
		c.setUint16(14, day, true);
		c.setUint32(16, crc, true);
		c.setUint32(20, size, true);
		c.setUint32(24, size, true);
		c.setUint16(28, name.length, true);
		// 30 extra, 32 comment, 34 disk, 36 internal attrs, 38 external attrs: all 0.
		c.setUint32(42, offset, true); // where its local header starts
		central.set(name, 46);

		locals.push(local, entry.data);
		centrals.push(central);
		offset += local.length + size;
	}

	const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);

	const end = new Uint8Array(22);
	const e = new DataView(end.buffer);
	e.setUint32(0, 0x06054b50, true); // end of central directory signature
	e.setUint16(8, entries.length, true); // entries on this disk
	e.setUint16(10, entries.length, true); // entries in total
	e.setUint32(12, directorySize, true);
	e.setUint32(16, offset, true); // where the central directory starts

	return concat([...locals, ...centrals, end]);
}

/** MS-DOS packs a timestamp into two 16-bit words, at two-second resolution. */
function dosDateTime(date: Date): { time: number; day: number } {
	const year = Math.max(date.getFullYear(), 1980);
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
		day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

let table: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3, the polynomial ZIP uses), table-driven. */
export function crc32(data: Uint8Array): number {
	if (!table) {
		table = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c >>> 0;
		}
	}

	let crc = 0xffffffff;
	for (const byte of data) crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
