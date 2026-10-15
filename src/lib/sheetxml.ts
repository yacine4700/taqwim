/**
 * أقلّ ما يلزم من قراءة ورقة Excel وكتابة رقم في خانة.
 *
 * لا نحلّل XML تحليلًا كاملًا عن قصد: نقرأ ما نحتاجه (نصوص الخانات) ونكتب
 * قيمة عددية في خانة موجودة دون أن نمسّ سمة النمط `s` ولا بقية الورقة. فكلّ
 * ما لم نكتبه يخرج كما دخل — وهذا هو شرط وثيقة ترسل إلى الوزارة.
 */

/** فهرس العمود من اسمه: A=0، B=1، AA=26. */
export function columnIndex(name: string): number {
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - rest) / 26);
  }
  return out;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

/** نصوص الجدول المشترك: كل <si> قد تحوي عدّة <t> فتُوصل. */
export function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  const items = xml.match(/<si>[\s\S]*?<\/si>|<si\s*\/>/g) ?? [];
  for (const item of items) {
    const parts = item.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
    out.push(
      parts
        .map((p) => unescapeXml(p.replace(/<t[^>]*>/, "").replace(/<\/t>$/, "")))
        .join(""),
    );
  }
  return out;
}

export type Cell = { ref: string; column: number; text: string };
export type Row = { number: number; cells: Cell[] };

/** صفوف الورقة بنصوص خاناتها، مفكوكةً من الجدول المشترك. */
export function readRows(xml: string, shared: string[]): Row[] {
  const body = xml.slice(xml.indexOf("<sheetData"), xml.indexOf("</sheetData>") + 1);
  const rows: Row[] = [];
  const rowPattern = /<row[^>]*\sr="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(body))) {
    const number = Number(rowMatch[1]);
    const inner = rowMatch[2] ?? "";
    const cells: Cell[] = [];
    const cellPattern = /<c\s+r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(inner))) {
      const [, column, , attributes, content] = cellMatch;
      if (!content) continue;
      const type = /\st="([^"]+)"/.exec(attributes)?.[1] ?? "n";
      let text = "";
      if (type === "s") {
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(content)?.[1] ?? "-1");
        text = shared[index] ?? "";
      } else if (type === "inlineStr") {
        const parts = content.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
        text = parts
          .map((p) => unescapeXml(p.replace(/<t[^>]*>/, "").replace(/<\/t>$/, "")))
          .join("");
      } else {
        text = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(content)?.[1] ?? "");
      }
      cells.push({ ref: `${column}${number}`, column: columnIndex(column), text });
    }
    rows.push({ number, cells });
  }
  return rows;
}

export function cellAt(row: Row | undefined, column: number): string {
  return row?.cells.find((c) => c.column === column)?.text ?? "";
}

/**
 * يكتب قيمة عددية في خانة.
 *
 * الخانة في وثيقة حجز النقاط موجودة وفارغة بنمطها (`<c r="E9" s="2" />`)،
 * فنستبدل محتواها ونُبقي النمط. وإن لم تكن موجودة أُدرجت في موضعها من الصفّ
 * مرتَّبةً، فلا يختلّ ترتيب الخانات الذي تشترطه Excel.
 *
 * وتمرير null يفرّغ الخانة بدل أن يكتب صفرًا.
 */
export function setNumber(xml: string, ref: string, value: number | null): string {
  const parsed = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!parsed) return xml;
  const column = columnIndex(parsed[1]);
  const rowNumber = Number(parsed[2]);

  const rowPattern = new RegExp(
    `<row[^>]*\\sr="${rowNumber}"[^>]*(?:/>|>[\\s\\S]*?</row>)`,
  );
  const rowMatch = rowPattern.exec(xml);
  if (!rowMatch) return xml;
  const rowXml = rowMatch[0];

  const cellPattern = new RegExp(
    `<c\\s+r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`,
  );
  const cellMatch = cellPattern.exec(rowXml);

  let nextRow: string;
  if (cellMatch) {
    // النمط يبقى، والنوع يُنزع لأن القيمة صارت عددًا.
    const attributes = cellMatch[1].replace(/\st="[^"]*"/, "").trimEnd();
    const replacement =
      value === null
        ? `<c r="${ref}"${attributes} />`
        : `<c r="${ref}"${attributes}><v>${value}</v></c>`;
    nextRow = rowXml.replace(cellPattern, replacement);
  } else {
    if (value === null) return xml;
    const cell = `<c r="${ref}"><v>${value}</v></c>`;
    const openEnd = rowXml.indexOf(">") + 1;
    if (rowXml.endsWith("/>")) {
      // صفّ فارغ مغلق على نفسه: يُفتح ليسع الخانة.
      const open = rowXml.slice(0, rowXml.length - 2).trimEnd();
      nextRow = `${open}>${cell}</row>`;
    } else {
      const inner = rowXml.slice(openEnd, rowXml.length - "</row>".length);
      const after = /<c\s+r="([A-Z]+)\d+"/g;
      let insertAt = inner.length;
      let found: RegExpExecArray | null;
      while ((found = after.exec(inner))) {
        if (columnIndex(found[1]) > column) {
          insertAt = found.index;
          break;
        }
      }
      nextRow =
        rowXml.slice(0, openEnd) +
        inner.slice(0, insertAt) +
        cell +
        inner.slice(insertAt) +
        "</row>";
    }
  }
  return xml.slice(0, rowMatch.index) + nextRow + xml.slice(rowMatch.index + rowXml.length);
}
