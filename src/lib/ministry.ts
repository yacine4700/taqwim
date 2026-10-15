/**
 * وثيقة حجز النقاط: قراءتها، ومطابقة تلاميذها بتلاميذ القسم، وملء العلامات.
 *
 * الوثيقة تُرسل وزاريًا ولها بنية مضبوطة، فالتطبيق لا يصنع واحدة من عنده:
 * يفتح التي نزّلها الأستاذ ويكتب فيها. وهذا ليس تفضيلًا في الشكل — الوثيقة
 * تحمل رقم تعريف كل تلميذ ورمز المادة ورمز المؤسسة ورمز الورقة، وهي أرقام
 * لا تُخترع، ولو اختُرعت لرُفضت الوثيقة.
 *
 * وما لا نكتبه لا نمسّه: الترويسات والتنسيق وحماية الورقة تخرج كما دخلت.
 *
 * بنية كل ورقة (من عيّنات حقيقية):
 *   1-5  ترويسات موحّدة (الجمهورية، الوزارة، المديرية، المؤسسة، عنوان الوثيقة)
 *   6    رمز الورقة | السنة والفصل (20242) | رمز المادة | رمز المؤسسة
 *   7    رؤوس آلية مخفية: matricule nom prenom date_n ثم رموز الخانات ثم obs cons
 *   8    رؤوس عربية مقروءة
 *   9+   التلاميذ، وخانات العلامات موجودة فارغة بنمطها
 *
 * ورموز خانات العلامات تختلف من ورقة إلى ورقة — فورقة فيها 01/02/03/09
 * وأخرى 01/03/09 بلا أعمال تطبيقية — فتُقرأ من السطر 7 ولا تُفترض أبدًا.
 */

import { normalizeName } from "./names";
import { cellAt, columnName, readRows, setNumber, sharedStrings, type Row } from "./sheetxml";
import { entryText, readZip, textEntry, writeZip, type ZipEntry } from "./zip";

/** رموز الوزارة لخانات العلامات، مقابلَ أكواد مركّبات التطبيق. */
export const MINISTRY_CODES: Record<string, string> = {
  "01": "cc",
  "02": "tp",
  "03": "devoir",
  "09": "exam",
};

const FIXED = new Set(["matricule", "nom", "prenom", "date_n", "obs", "cons"]);

export type MarkColumn = {
  /** رمز الوزارة كما في السطر 7. */
  code: string;
  /** كود المركّبة في التطبيق، أو null إن كانت خانة لا يملؤها هذا التطبيق. */
  component: string | null;
  label: string;
  column: number;
};

export type MinistryStudent = {
  row: number;
  matricule: string;
  /** اللقب ثم الاسم، كما يكتبهما الأستاذ عادة. */
  name: string;
  nom: string;
  prenom: string;
};

export type MinistrySheet = {
  /** مسار الورقة داخل الأرشيف. */
  path: string;
  /** اسم الورقة في المصنّف، وهو رمزها (3112001). */
  name: string;
  title: string;
  subject: string;
  group: string;
  year: string;
  /** الفصل المقروء من السطر 6، أو null إن تعذّر. */
  term: number | null;
  columns: MarkColumn[];
  students: MinistryStudent[];
  xml: string;
  /** كُتب فيها شيء. غيرها يُنسخ كما هو، مضغوطًا كما كان. */
  dirty: boolean;
};

export type MinistryDoc = { entries: ZipEntry[]; sheets: MinistrySheet[] };

export class MinistryError extends Error {}

function attr(xml: string, tag: string, name: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const value = new RegExp(`\\s${name}="([^"]*)"`).exec(match[0])?.[1];
    if (value !== undefined) out.push(value);
  }
  return out;
}

/** «… الفوج التربوي : أولى ثانوي … 1 مادة : العلوم الطبيعة والحياة» */
function splitTitle(title: string): { group: string; subject: string; year: string } {
  const subject = /مادة\s*:\s*([\s\S]*)$/.exec(title)?.[1].trim() ?? "";
  const group = /الفوج التربوي\s*:\s*([\s\S]*?)\s*مادة\s*:/.exec(title)?.[1].trim() ?? "";
  const year = /السنة الدراسية\s*:\s*([0-9]{4}-[0-9]{4})/.exec(title)?.[1] ?? "";
  return { group, subject, year };
}

function readSheet(path: string, name: string, xml: string, shared: string[]): MinistrySheet | null {
  const rows = readRows(xml, shared);
  const byNumber = new Map<number, Row>(rows.map((r) => [r.number, r]));

  const codesRow = rows.find((r) => cellAt(r, 0).trim() === "matricule");
  if (!codesRow) return null;
  const labelsRow = byNumber.get(codesRow.number + 1);

  const columns: MarkColumn[] = [];
  for (const cell of codesRow.cells) {
    const code = cell.text.trim();
    if (!code || FIXED.has(code)) continue;
    columns.push({
      code,
      component: MINISTRY_CODES[code] ?? null,
      label: cellAt(labelsRow, cell.column) || code,
      column: cell.column,
    });
  }

  const students: MinistryStudent[] = [];
  for (const row of rows) {
    if (row.number <= codesRow.number + 1) continue;
    const matricule = cellAt(row, 0).trim();
    const nom = cellAt(row, 1).trim();
    const prenom = cellAt(row, 2).trim();
    if (!matricule || (!nom && !prenom)) continue;
    students.push({
      row: row.number,
      matricule,
      nom,
      prenom,
      name: `${nom} ${prenom}`.trim(),
    });
  }

  const title = cellAt(byNumber.get(5), 0).trim();
  const stamp = cellAt(byNumber.get(codesRow.number - 1), 1).trim();
  const term = /^\d{5}$/.test(stamp) ? Number(stamp.slice(4)) : null;
  const { group, subject, year } = splitTitle(title);

  return {
    path,
    name,
    title,
    subject,
    group,
    year,
    term: term && term >= 1 && term <= 3 ? term : null,
    columns,
    students,
    xml,
    dirty: false,
  };
}

/** يفتح الملف ويقرأ أوراقه التي تشبه وثيقة حجز النقاط. */
export async function readMinistryFile(bytes: Uint8Array): Promise<MinistryDoc> {
  const entries = readZip(bytes);
  const find = (name: string) => entries.find((e) => e.name === name);

  const workbook = find("xl/workbook.xml");
  const rels = find("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new MinistryError("هذا ليس ملف Excel صالحًا");

  const workbookXml = await entryText(workbook);
  const relsXml = await entryText(rels);
  const sharedEntry = find("xl/sharedStrings.xml");
  const shared = sharedEntry ? sharedStrings(await entryText(sharedEntry)) : [];

  const targets = new Map<string, string>();
  const ids = attr(relsXml, "Relationship", "Id");
  const paths = attr(relsXml, "Relationship", "Target");
  ids.forEach((id, i) => targets.set(id, paths[i]));

  const names = attr(workbookXml, "sheet", "name");
  const rids = attr(workbookXml, "sheet", "r:id");

  const sheets: MinistrySheet[] = [];
  for (let i = 0; i < names.length; i++) {
    const target = targets.get(rids[i]);
    if (!target) continue;
    const path = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`;
    const entry = find(path);
    if (!entry) continue;
    const sheet = readSheet(path, names[i], await entryText(entry), shared);
    if (sheet && sheet.students.length) sheets.push(sheet);
  }

  if (!sheets.length) {
    throw new MinistryError("لم أجد أوراق حجز نقاط في هذا الملف");
  }
  return { entries, sheets };
}

/* ---------- مطابقة الأسماء ---------- */

/** مفتاح أرخى: يُسقط «ال» من أوّل كل كلمة، فيلتقي «العيورات» و«عيورات». */
function loose(text: string): string {
  return normalizeName(text)
    .split(" ")
    .map((word) => (word.length > 3 && word.startsWith("ال") ? word.slice(2) : word))
    .sort()
    .join(" ");
}

export type Pairing<T> = {
  pairs: Array<{ student: T; row: MinistryStudent }>;
  /** تلاميذ القسم بلا سطر في الوثيقة. */
  unmatched: T[];
  /** سطور في الوثيقة بلا تلميذ في القسم. */
  extra: MinistryStudent[];
};

/**
 * يطابق تلاميذ القسم بسطور الوثيقة: بالاسم تامًّا، ثم بالمفتاح الأرخى،
 * ثم بترتيب مقلوب (الاسم قبل اللقب). وما لم يُطابَق يُعرض على الأستاذ ولا
 * يُملأ: علامةٌ في سطر الخطأ أسوأ من خانة فارغة.
 */
export function matchStudents<T extends { full_name: string }>(
  students: T[],
  rows: MinistryStudent[],
): Pairing<T> {
  const taken = new Set<number>();
  const pairs: Pairing<T>["pairs"] = [];
  const unmatched: T[] = [];

  const exact = new Map<string, MinistryStudent[]>();
  const relaxed = new Map<string, MinistryStudent[]>();
  const add = (map: Map<string, MinistryStudent[]>, key: string, row: MinistryStudent) => {
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  };
  for (const row of rows) {
    add(exact, normalizeName(row.name), row);
    add(exact, normalizeName(`${row.prenom} ${row.nom}`), row);
    add(relaxed, loose(row.name), row);
  }

  const take = (map: Map<string, MinistryStudent[]>, key: string) =>
    map.get(key)?.find((row) => !taken.has(row.row)) ?? null;

  for (const student of students) {
    const name = student.full_name;
    const row =
      take(exact, normalizeName(name)) ?? take(relaxed, loose(name)) ?? null;
    if (row) {
      taken.add(row.row);
      pairs.push({ student, row });
    } else {
      unmatched.push(student);
    }
  }

  return { pairs, unmatched, extra: rows.filter((row) => !taken.has(row.row)) };
}

/* ---------- الملء ---------- */

export type Write = { row: number; component: string; value: number | null };

export function round2(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(2));
}

/**
 * يكتب العلامات في الورقة ويرجع عدد ما كُتب.
 * الخانة التي لا مقابل لها في الوثيقة تُتجاهل ويُبلَّغ بها، ولا تُكتب في غيرها.
 */
export function fillSheet(
  sheet: MinistrySheet,
  writes: Write[],
): { written: number; missingColumns: string[] } {
  const byComponent = new Map<string, MarkColumn>();
  for (const column of sheet.columns) {
    if (column.component) byComponent.set(column.component, column);
  }

  let xml = sheet.xml;
  let written = 0;
  let touched = false;
  const missing = new Set<string>();
  for (const write of writes) {
    const column = byComponent.get(write.component);
    if (!column) {
      if (write.value !== null) missing.add(write.component);
      continue;
    }
    xml = setNumber(xml, `${columnName(column.column)}${write.row}`, write.value);
    touched = true;
    if (write.value !== null) written++;
  }
  sheet.xml = xml;
  // الورقة التي لم تُمسّ تُنسخ بايتًا ببايت كما كانت، مضغوطةً كما كانت.
  if (touched) sheet.dirty = true;
  return { written, missingColumns: [...missing] };
}

/** يعيد بناء الملف بما كُتب في أوراقه. */
export function saveMinistryFile(doc: MinistryDoc): Uint8Array {
  const changed = new Map(
    doc.sheets.filter((s) => s.dirty).map((s) => [s.path, s.xml]),
  );
  const entries = doc.entries.map((entry) => {
    const xml = changed.get(entry.name);
    return xml === undefined ? entry : textEntry(entry, xml);
  });
  return writeZip(entries);
}
