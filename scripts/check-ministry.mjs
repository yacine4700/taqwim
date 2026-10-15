/* نسخة حرفية من الدوالّ الخطرة في src/lib/sheetxml.ts و src/lib/ministry.ts:
   ما يقرّر في أيّ خانة تُكتب العلامة، ومَن يُطابَق بمن. خطأٌ فيها يفسد وثيقة
   تُرسل وزاريًا دون أن يظهر خطأ. النسختان يجب أن تبقيا متطابقتين. */

/* ---------- sheetxml ---------- */

function columnIndex(name) {
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function columnName(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - rest) / 26);
  }
  return out;
}

function setNumber(xml, ref, value) {
  const parsed = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!parsed) return xml;
  const column = columnIndex(parsed[1]);
  const rowNumber = Number(parsed[2]);

  const rowPattern = new RegExp(`<row[^>]*\\sr="${rowNumber}"[^>]*(?:/>|>[\\s\\S]*?</row>)`);
  const rowMatch = rowPattern.exec(xml);
  if (!rowMatch) return xml;
  const rowXml = rowMatch[0];

  const cellPattern = new RegExp(`<c\\s+r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const cellMatch = cellPattern.exec(rowXml);

  let nextRow;
  if (cellMatch) {
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
      const open = rowXml.slice(0, rowXml.length - 2).trimEnd();
      nextRow = `${open}>${cell}</row>`;
    } else {
      const inner = rowXml.slice(openEnd, rowXml.length - "</row>".length);
      const after = /<c\s+r="([A-Z]+)\d+"/g;
      let insertAt = inner.length;
      let found;
      while ((found = after.exec(inner))) {
        if (columnIndex(found[1]) > column) { insertAt = found.index; break; }
      }
      nextRow = rowXml.slice(0, openEnd) + inner.slice(0, insertAt) + cell + inner.slice(insertAt) + "</row>";
    }
  }
  return xml.slice(0, rowMatch.index) + nextRow + xml.slice(rowMatch.index + rowXml.length);
}

/* ---------- ministry ---------- */

function normalizeName(text) {
  return text
    .normalize("NFKC")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loose(text) {
  return normalizeName(text)
    .split(" ")
    .map((word) => (word.length > 3 && word.startsWith("ال") ? word.slice(2) : word))
    .sort()
    .join(" ");
}

function matchStudents(students, rows) {
  const taken = new Set();
  const pairs = [];
  const unmatched = [];

  const exact = new Map();
  const relaxed = new Map();
  const add = (map, key, row) => {
    const list = map.get(key);
    if (list) list.push(row); else map.set(key, [row]);
  };
  for (const row of rows) {
    add(exact, normalizeName(row.name), row);
    add(exact, normalizeName(`${row.prenom} ${row.nom}`), row);
    add(relaxed, loose(row.name), row);
  }

  const take = (map, key) => map.get(key)?.find((row) => !taken.has(row.row)) ?? null;

  for (const student of students) {
    const name = student.full_name;
    const row = take(exact, normalizeName(name)) ?? take(relaxed, loose(name)) ?? null;
    if (row) { taken.add(row.row); pairs.push({ student, row }); }
    else unmatched.push(student);
  }
  return { pairs, unmatched, extra: rows.filter((row) => !taken.has(row.row)) };
}

/* ---------- أدوات الاختبار ---------- */

let pass = 0, fail = 0;
function t(name, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
}

const row = (n, nom, prenom) => ({ row: n, matricule: `m${n}`, nom, prenom, name: `${nom} ${prenom}`.trim() });

console.log("\n1. أسماء الأعمدة: الخانة تُحسب لا تُخمَّن");
t("A", columnIndex("A"), 0);
t("E", columnIndex("E"), 4);
t("Z", columnIndex("Z"), 25);
t("AA", columnIndex("AA"), 26);
t("ذهابًا وإيابًا", [0, 4, 25, 26, 27, 51, 52].map((i) => columnIndex(columnName(i))), [0, 4, 25, 26, 27, 51, 52]);

console.log("\n2. الكتابة في الخانة: النمط يبقى وما حولها لا يُمسّ");
const ROW = '<row r="9" spans="1:10" ht="24.95" customHeight="1"><c r="A9" s="1" t="s"><v>21</v></c><c r="B9" s="1" t="s"><v>22</v></c><c r="E9" s="2" /><c r="F9" s="2" /><c r="G9" s="2" /></row>';
const SHEET = `<worksheet><sheetData><row r="8"><c r="A8" s="3" t="s"><v>1</v></c></row>${ROW}<row r="10"><c r="E10" s="2" /></row></sheetData><sheetProtection password="E3F1" sheet="1" /></worksheet>`;

let out = setNumber(SHEET, "E9", 12.5);
t("القيمة في خانتها", /<c r="E9" s="2"><v>12\.5<\/v><\/c>/.test(out), true);
t("النمط s=2 باقٍ", out.includes('r="E9" s="2"'), true);
t("الخانة المجاورة لم تُمسّ", out.includes('<c r="F9" s="2" />'), true);
t("اسم التلميذ لم يُمسّ", out.includes('<c r="A9" s="1" t="s"><v>21</v></c>'), true);
t("حماية الورقة باقية", out.includes('<sheetProtection password="E3F1" sheet="1" />'), true);
t("ارتفاع السطر باقٍ", out.includes('ht="24.95" customHeight="1"'), true);
t("سطر آخر لم يُمسّ", out.includes('<row r="10"><c r="E10" s="2" /></row>'), true);

out = setNumber(setNumber(SHEET, "E9", 12.5), "E9", 17);
t("الكتابة الثانية تحلّ محلّ الأولى", /<c r="E9" s="2"><v>17<\/v><\/c>/.test(out), true);
t("ولا تتركان قيمتين", (out.match(/r="E9"/g) ?? []).length, 1);

out = setNumber(setNumber(SHEET, "E9", 12.5), "E9", null);
t("التفريغ يرجع الخانة فارغة لا صفرًا", out.includes('<c r="E9" s="2" />'), true);
t("ولا يترك <v>", /<c r="E9"[^>]*><v>/.test(out), false);

out = setNumber(SHEET, "C9", 9);
t("خانة غائبة تُدرج في موضعها", out.indexOf('r="C9"') > out.indexOf('r="B9"'), true);
t("وقبل التي بعدها", out.indexOf('r="C9"') < out.indexOf('r="E9"'), true);
t("التفريغ لخانة غائبة لا يفعل شيئًا", setNumber(SHEET, "C9", null), SHEET);
t("سطر غير موجود لا يفعل شيئًا", setNumber(SHEET, "E99", 10), SHEET);

const typed = '<worksheet><sheetData><row r="9"><c r="E9" s="4" t="s"><v>7</v></c></row></sheetData></worksheet>';
t("النوع النصّي يُنزع حين تصير القيمة عددًا", setNumber(typed, "E9", 8).includes('t="s"'), false);
t("ويبقى النمط", setNumber(typed, "E9", 8).includes('s="4"'), true);

console.log("\n3. توحيد الاسم: الملفّان يكتبان الهمزة والتاء بأشكال مختلفة");
t("ألف بهمزة = ألف", normalizeName("أولاد إبراهيم"), normalizeName("اولاد ابراهيم"));
t("تاء مربوطة = هاء", normalizeName("بوحميدة"), normalizeName("بوحميده"));
t("ألف مقصورة = ياء", normalizeName("قرباتى"), normalizeName("قرباتي"));
t("التشكيل يسقط", normalizeName("مُحَمَّد"), "محمد");
t("التطويل يسقط", normalizeName("محـــمد"), "محمد");
t("المسافات تُجمع", normalizeName("  بن   عامر  "), "بن عامر");

console.log("\n4. المطابقة: ولا علامة في سطر غير صاحبها");
const sheetRows = [row(9, "أولاد إبراهيم", "راضية"), row(10, "العيورات", "سلسبيل"), row(11, "بن عامر", "فردوس")];
let m = matchStudents(
  [{ full_name: "اولاد ابراهيم راضيه" }, { full_name: "بن عامر فردوس" }],
  sheetRows,
);
t("يطابق رغم اختلاف الرسم", m.pairs.map((p) => p.row.row), [9, 11]);
t("ويعدّ الباقي زائدًا", m.extra.map((r) => r.row), [10]);

m = matchStudents([{ full_name: "راضية أولاد إبراهيم" }], sheetRows);
t("الاسم قبل اللقب يُطابَق أيضًا", m.pairs[0]?.row.row, 9);

m = matchStudents([{ full_name: "العيورات سلسبيل" }, { full_name: "عيورات سلسبيل" }], sheetRows);
t("«ال» الزائدة تُطابَق", m.pairs[0]?.row.row, 10);
t("ولا يُطابَق سطر واحد بتلميذين", m.pairs.length, 1);
t("والثاني يُعرض بلا سطر", m.unmatched.map((s) => s.full_name), ["عيورات سلسبيل"]);

m = matchStudents([{ full_name: "فلان الفلاني" }], sheetRows);
t("من لا سطر له لا يُملأ له شيء", m.pairs.length, 0);
t("ويُعرض على الأستاذ", m.unmatched.length, 1);
t("ولا تُستهلك سطور الوثيقة", m.extra.length, 3);

const twins = [row(9, "بن عامر", "محمد"), row(10, "بن عامر", "محمد")];
m = matchStudents([{ full_name: "بن عامر محمد" }, { full_name: "بن عامر محمد" }], twins);
t("متشابها الاسم يأخذ كلٌّ سطرًا", m.pairs.map((p) => p.row.row), [9, 10]);

t("قسم فارغ لا ينهار", matchStudents([], sheetRows).extra.length, 3);
t("وثيقة بلا سطور كذلك", matchStudents([{ full_name: "أ ب" }], []).unmatched.length, 1);

console.log(`\n${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail ? 1 : 0);
