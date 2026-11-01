import { normalizeName } from "./names";

/**
 * قراءة قوائم التلاميذ من جداول Excel ومن نصّ ملصوق، دون أي خدمة خارجية.
 *
 * الترتيب الذي تقوم عليه الاستيراد: ما يفهمه الشفرة وحدها لا يُرسل إلى أحد
 * (أسرع، ومجاني، وأسماء القُصَّر لا تغادر الهاتف)، وما عجزت عنه ورقةٌ بعينها
 * تُرسل نصًّا إلى Gemini. وهذا الملف هو الدرجة الأولى؛ يجرّب لكل ورقة ثلاث
 * طرق بالترتيب ويقف عند أول نجاح:
 *   1. ملف الإشراف التربوي (قالب الوزارة: «الرقم» ورأس الجدول).
 *   2. رأس يحمل «اللقب» أو «الاسم».
 *   3. عمود (أو عمودان متجاوران) أغلبه أسماء عربية، حين لا رأس.
 *
 * scripts/check-rosterparse.mjs يشغّله مباشرة.
 */

export type Cell = string | number | boolean | Date | null | undefined;
export type Grid = Cell[][];

export type SheetRoster = {
  cls: string;
  names: string[];
  how: "ministry" | "header" | "column";
};

/** كلمات أسطر ليست أسماء تلاميذ: عناوين ومجاميع وتواقيع، بعد التوحيد ونزع «ال». */
const NOISE_WORDS = new Set([
  "مجموع", "استاذ", "استاذه", "ملاحظات", "ملاحظه", "معدل", "توقيع", "امضاء",
  "رقم", "اسم", "لقب", "تاريخ", "جنس", "قسم", "مؤسسه", "ثانويه", "سنه",
  "فصل", "عدد", "تلاميذ", "قائمه",
]);

/** كلمات تبيّن أن عمود الاسم ليس اسم التلميذ: «اسم الأب» و«اسم الولي». */
const OTHER_PERSON = new Set(["اب", "ام", "ولي", "مدرسه", "قسم", "مؤسسه"]);

const DIGITS = "0-9٠-٩۰-۹";

function cellText(cell: Cell): string {
  if (cell == null) return "";
  if (cell instanceof Date) return "";
  return String(cell).replace(/\s+/g, " ").trim();
}

function stripAl(word: string): string {
  return word.startsWith("ال") && word.length > 3 ? word.slice(2) : word;
}

/** سطر عنوان أو مجموع أو توقيع: ليس اسم تلميذ. */
function isNoise(text: string): boolean {
  const normalized = normalizeName(text);
  if (!normalized) return true;
  const words = normalized.split(" ");
  const first = stripAl(words[0]);
  return NOISE_WORDS.has(first) && (words.length <= 3 || /[:：]/.test(text));
}

/**
 * يرجع الاسم نظيفًا من الترقيم وتواريخ الميلاد، أو "" إن لم يكن اسمًا.
 * لا يصحّح إملاءً ولا يغيّر همزة: الاسم يبقى كما كُتب.
 */
export function cleanName(raw: string): string {
  let text = raw
    .replace(/\s+/g, " ")
    // ترقيم في أول السطر: «1-» «1.» «١)» «12 /»
    .replace(new RegExp(`^\\s*[${DIGITS}]+\\s*[-.)/\\\\:،]*\\s*`), "")
    // تواريخ ميلاد: 12/03/2008 أو 2008-03-12
    .replace(new RegExp(`[${DIGITS}]{1,4}\\s*[/\\-.]\\s*[${DIGITS}]{1,2}\\s*[/\\-.]\\s*[${DIGITS}]{1,4}`, "g"), " ")
    .replace(new RegExp(`[${DIGITS}]+`, "g"), " ")
    .replace(/[|•·▪■]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/^[-.)/:،\s]+|[-.)/:،\s]+$/g, "").trim();
  if (text.length < 2) return "";
  if (!/\p{L}/u.test(text)) return "";
  if (isNoise(text)) return "";
  return text;
}

/**
 * نصّ يلصقه الأستاذ أو يكتبه، سطر لكل تلميذ. يقصّ الترقيم والتواريخ،
 * وإن لصق أعمدة من Excel (مفصولة بـ Tab) أخذ منها الاسم وحده.
 * ما يُحذف يُعدّ ولا يُخفى: يعرضه الاستيراد.
 */
export function cleanPastedText(text: string): {
  names: string[];
  dropped: number;
  repeated: string[];
} {
  const names: string[] = [];
  const repeated: string[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const name = line.includes("\t") ? nameFromCells(line.split("\t")) : cleanName(line);
    if (!name) {
      dropped++;
      continue;
    }
    const key = normalizeName(name);
    if (seen.has(key)) repeated.push(name);
    seen.add(key);
    names.push(name);
  }
  return { names, dropped, repeated };
}

/** من خلايا صفّ مفصولة: أول مقطع متتابع من الخلايا الحرفية (لقب ثم اسم)، دون الجنس. */
function nameFromCells(cells: string[]): string {
  const parts: string[] = [];
  let started = false;
  for (const cell of cells) {
    const clean = cleanName(cell);
    if (clean && !GENDER.has(normalizeName(clean))) {
      parts.push(clean);
      started = true;
    } else if (started) {
      break;
    }
  }
  return parts.join(" ");
}

const GENDER = new Set(["ذكر", "انثي", "انثى", "أنثى", "ذكور", "اناث", "m", "f"].map(normalizeName));

/* ---------------- الأوراق ---------------- */

function isEmptyGrid(grid: Grid): boolean {
  return !grid.some((row) => (row ?? []).some((cell) => cellText(cell) !== ""));
}

/** ورقة بلا أي خلية: لا تُعدّ فاشلة، بل لا شيء فيها. */
export function sheetIsEmpty(grid: Grid): boolean {
  return isEmptyGrid(grid);
}

/** اسم القسم: خلية «القسم: …» في أعلى الورقة، وإلا اسم الورقة إن لم يكن عامًّا. */
function findClassLabel(grid: Grid, sheetName: string): string {
  for (const row of grid.slice(0, 15)) {
    for (const cell of row ?? []) {
      const text = cellText(cell);
      if (text.includes("القسم") && /[:：]/.test(text)) {
        const label = text.split(/[:：]/).slice(1).join(":").trim();
        if (label) return label;
      }
    }
  }
  return sheetLabel(sheetName);
}

/** اسم الورقة قسمًا مقترحًا، إلا إن كان اسمًا عامًّا من صنع البرنامج (Sheet1، ورقة2). */
export function sheetLabel(sheetName: string): string {
  return /^(sheet|ورقة|feuil|worksheet)\s*\d*$/i.test(sheetName.trim()) ? "" : sheetName.trim();
}

/* ملفات الإشراف التربوي تضع القسم في I2 والأسماء في العمود C ابتداءً من السطر 7 */
function parseMinistry(grid: Grid): { names: string[]; cls: string } | null {
  let cls = "";
  for (const row of grid.slice(0, 6)) {
    for (const cell of row ?? []) {
      const text = cellText(cell);
      if (text.includes("القسم") && text.includes(":")) {
        cls = text.split(":").slice(1).join(":").trim();
      }
    }
  }
  let header = -1;
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    if ((grid[i] ?? []).some((cell) => cellText(cell) === "الرقم")) {
      header = i;
      break;
    }
  }
  if (header < 0) return null;
  const headerRow = grid[header] ?? [];
  const nameColumns = headerRow
    .map((cell, index) => ({ text: cellText(cell), index }))
    .filter(({ text }) => text.includes("الاسم") || text.includes("اللقب"));
  // اللقب والاسم في عمودين منفصلين: ليست الصيغة التي كُتب لها هذا المحلّل
  // (عمود واحد)، فيأخذه محلّل الرأس الذي يجمعهما.
  if (nameColumns.length > 1) return null;
  const nameColumn = nameColumns.length ? nameColumns[0].index : 2;
  const names: string[] = [];
  for (let i = header + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const name = cellText(row[nameColumn]);
    const number = cellText(row[0]);
    if (name && number !== "" && !Number.isNaN(Number(number))) names.push(name);
  }
  return names.length ? { cls, names } : null;
}

/** رأس يحمل «اللقب» أو «الاسم»: يجمع عمودي اللقب والاسم في سطر واحد (اللقب أولًا). */
function parseHeader(grid: Grid): { names: string[]; cls: string } | null {
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const row = grid[i] ?? [];
    const columns: Array<{ index: number; last: boolean }> = [];
    row.forEach((cell, index) => {
      const words = normalizeName(cellText(cell))
        .split(" ")
        .map((w) => stripAl(w.replace(/^وال/, "ال")))
        .filter(Boolean);
      if (!words.length || words.length > 4) return;
      const isName = words.includes("اسم") || words.includes("لقب");
      if (!isName) return;
      if (words.some((w) => OTHER_PERSON.has(w))) return;
      columns.push({ index, last: words.includes("لقب") && !words.includes("اسم") });
    });
    if (!columns.length) continue;
    // اللقب قبل الاسم في السطر المكتوب، أيًّا كان ترتيب العمودين في الورقة.
    const ordered = [...columns].sort((a, b) => Number(b.last) - Number(a.last) || a.index - b.index);
    const names: string[] = [];
    for (const data of grid.slice(i + 1)) {
      const parts = ordered
        .map((column) => cleanName(cellText((data ?? [])[column.index])))
        .filter(Boolean);
      if (parts.length) names.push(parts.join(" "));
    }
    if (names.length >= 2) return { names, cls: "" };
  }
  return null;
}

const ARABIC = /[؀-ۿ]/;

/** خلية تبدو اسمًا: حروف عربية فقط، من كلمة إلى خمس. */
function looksLikeName(text: string): boolean {
  if (!text || new RegExp(`[${DIGITS}]`).test(text)) return false;
  if (!ARABIC.test(text)) return false;
  const words = text.split(" ").filter(Boolean);
  return words.length >= 1 && words.length <= 5 && !isNoise(text);
}

/** لا رأس: العمود الذي أغلب خلاياه أسماء مختلفة، وإن كان لقبًا واسمًا في عمودين متجاورين جمعهما. */
function parseColumns(grid: Grid): { names: string[]; cls: string } | null {
  const width = Math.max(0, ...grid.map((row) => (row ?? []).length));
  const good: number[] = [];
  for (let c = 0; c < width; c++) {
    const cells = grid.map((row) => cellText((row ?? [])[c])).filter(Boolean);
    const matching = cells.filter(looksLikeName);
    if (matching.length < 5) continue;
    if (matching.length / cells.length < 0.7) continue;
    // عمود الجنس «ذكر/أنثى» يتكرّر؛ الأسماء قلّما تتكرّر
    if (new Set(matching.map(normalizeName)).size / matching.length < 0.6) continue;
    good.push(c);
  }
  if (!good.length) return null;
  // أول عمود، ومعه المتجاور له إن كان هو الآخر أسماء (اللقب والاسم منفصلين)
  const first = good[0];
  const columns = good[1] === first + 1 ? [first, first + 1] : [first];
  const names: string[] = [];
  for (const row of grid) {
    const parts = columns.map((c) => cleanName(cellText((row ?? [])[c]))).filter(Boolean);
    if (parts.length === columns.length && parts.every(looksLikeName)) names.push(parts.join(" "));
  }
  return names.length >= 5 ? { names, cls: "" } : null;
}

/** يجرّب الطرق الثلاث بالترتيب على ورقة واحدة. null = تُترك للذكاء الاصطناعي. */
export function parseSheetGrid(grid: Grid, sheetName: string): SheetRoster | null {
  const ministry = parseMinistry(grid);
  if (ministry) return { cls: ministry.cls || findClassLabel(grid, sheetName), names: ministry.names, how: "ministry" };
  const header = parseHeader(grid);
  if (header) return { cls: findClassLabel(grid, sheetName), names: header.names, how: "header" };
  const columns = parseColumns(grid);
  if (columns) return { cls: findClassLabel(grid, sheetName), names: columns.names, how: "column" };
  return null;
}

/* ---------------- ما يُرسل إلى Gemini ---------------- */

/** حدّا الإرسال، ويطابقهما الخادم. */
export const MAX_AI_SHEETS = 12;
export const MAX_SHEET_CSV = 60_000;

/** ورقة نصًّا: صفوف غير فارغة، الخلايا مفصولة بفاصلة، مقصوصة إلى الحدّ. */
export function gridToCsv(grid: Grid): string {
  const lines: string[] = [];
  let size = 0;
  for (const row of grid) {
    const cells = (row ?? []).map((cell) => cellText(cell).replace(/[",\n]/g, " "));
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (!cells.length) continue;
    const line = cells.join(",");
    if (size + line.length + 1 > MAX_SHEET_CSV) break;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join("\n");
}
