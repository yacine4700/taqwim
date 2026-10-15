/**
 * فتح ملف xlsx وإعادة بنائه دون المساس بما لم نكتبه.
 *
 * لماذا لا نستعمل مكتبة xlsx التي يستوردها الاستيراد؟ لأنها تقرأ القيم وتكتب
 * ملفًا جديدًا، فيضيع كل ما في وثيقة حجز النقاط من تنسيق وحماية وترويسات
 * وزارية. والوثيقة تُرسل كما هي، فلا يجوز أن يعيدها التطبيق «مشابهة».
 *
 * فالمسلك هنا: الملف أرشيف zip، نفكّه ونعيد تركيبه بنسخ كل مدخلة كما هي
 * بايتًا ببايت، ولا نغيّر إلا ورقة واحدة نكتب فيها العلامات.
 *
 * الفكّ يحتاج DecompressionStream (موجود في المتصفّحات منذ 2023 وفي Node 18+).
 * أما ما نكتبه فنخزّنه بلا ضغط — zip صحيح تقرؤه Excel، ويوفّر علينا الحاجة
 * إلى CompressionStream.
 */

export type ZipEntry = {
  name: string;
  /** أعلام الترويسة، منزوعًا منها علم واصف البيانات (bit 3). */
  flags: number;
  /** 0 مخزَّن، 8 مضغوط. */
  method: number;
  time: number;
  date: number;
  crc: number;
  /** البايتات كما هي في الأرشيف، مضغوطة أو لا بحسب method. */
  body: Uint8Array;
  /** الحجم بعد الفكّ. */
  size: number;
};

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export class ZipError extends Error {}

/** يقرأ فهرس الأرشيف وينسخ بايتات كل مدخلة كما هي. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  const floor = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("ليس ملف xlsx سليمًا");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff) throw new ZipError("أرشيف ZIP64 غير مدعوم");

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL) throw new ZipError("فهرس الأرشيف تالف");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const time = view.getUint16(offset + 12, true);
    const date = view.getUint16(offset + 14, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );

    if (view.getUint32(localOffset, true) !== LOCAL) throw new ZipError("ترويسة مدخلة تالفة");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;

    entries.push({
      name,
      // الأحجام في الفهرس هي المعتمدة، فننزع علم واصف البيانات الذي يحيل عليها.
      flags: flags & ~0x08,
      method,
      time,
      date,
      crc,
      body: bytes.subarray(start, start + compressedSize),
      size,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** نصّ مدخلة بعد فكّ ضغطها. */
export async function entryText(entry: ZipEntry): Promise<string> {
  if (entry.method === 0) return new TextDecoder().decode(entry.body);
  if (entry.method !== 8) throw new ZipError(`ضغط غير مدعوم (${entry.method})`);
  if (typeof DecompressionStream === "undefined") {
    throw new ZipError("هذا المتصفّح لا يفكّ ضغط الملفات");
  }
  const stream = new Blob([entry.body as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  const buffer = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buffer);
}

/** مدخلة بديلة بالنصّ الجديد، مخزَّنة بلا ضغط. */
export function textEntry(entry: ZipEntry, text: string): ZipEntry {
  const body = new TextEncoder().encode(text);
  return { ...entry, method: 0, body, size: body.length, crc: crc32(body) };
}

/** يعيد بناء الأرشيف بترتيب مدخلاته كما كانت. */
export function writeZip(entries: ZipEntry[]): Uint8Array {
  const names = entries.map((e) => new TextEncoder().encode(e.name));
  let total = 22;
  entries.forEach((entry, i) => {
    total += 30 + names[i].length + entry.body.length;
    total += 46 + names[i].length;
  });

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let at = 0;

  entries.forEach((entry, i) => {
    offsets.push(at);
    view.setUint32(at, LOCAL, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, entry.flags, true);
    view.setUint16(at + 8, entry.method, true);
    view.setUint16(at + 10, entry.time, true);
    view.setUint16(at + 12, entry.date, true);
    view.setUint32(at + 14, entry.crc, true);
    view.setUint32(at + 18, entry.body.length, true);
    view.setUint32(at + 22, entry.size, true);
    view.setUint16(at + 26, names[i].length, true);
    view.setUint16(at + 28, 0, true);
    out.set(names[i], at + 30);
    out.set(entry.body, at + 30 + names[i].length);
    at += 30 + names[i].length + entry.body.length;
  });

  const centralStart = at;
  entries.forEach((entry, i) => {
    view.setUint32(at, CENTRAL, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, entry.flags, true);
    view.setUint16(at + 10, entry.method, true);
    view.setUint16(at + 12, entry.time, true);
    view.setUint16(at + 14, entry.date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.body.length, true);
    view.setUint32(at + 24, entry.size, true);
    view.setUint16(at + 28, names[i].length, true);
    view.setUint16(at + 30, 0, true);
    view.setUint16(at + 32, 0, true);
    view.setUint16(at + 34, 0, true);
    view.setUint16(at + 36, 0, true);
    view.setUint32(at + 38, 0, true);
    view.setUint32(at + 42, offsets[i], true);
    out.set(names[i], at + 46);
    at += 46 + names[i].length;
  });

  view.setUint32(at, EOCD, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);
  view.setUint16(at + 20, 0, true);

  return out;
}
