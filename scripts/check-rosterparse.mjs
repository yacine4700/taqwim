/* اختبار قراءة قوائم التلاميذ من جداول Excel ومن النصّ الملصوق (src/lib/rosterParse.ts).
   يستورد الشفرة الحقيقية. الأوراق تُمثَّل مصفوفات صفوف كما يعيدها
   XLSX.utils.sheet_to_json(header: 1)، فلا يحتاج الاختبار مكتبة xlsx. */

import {
  cleanName,
  cleanPastedText,
  gridToCsv,
  MAX_SHEET_CSV,
  parseSheetGrid,
  sheetIsEmpty,
} from "../src/lib/rosterParse.ts";

let pass = 0, fail = 0;
function t(name, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
}

const NAMES = ["بن عمر أمين", "حمو سعاد", "قاسمي يوسف", "بوزيد ليلى", "عيسى رضا", "ملاح نورة", "سعدي كريم"];

console.log("— تنظيف الاسم");
t("ترقيم في الأول", cleanName("12- بن عمر أمين"), "بن عمر أمين");
t("ترقيم عربي هندي", cleanName("١) حمو سعاد"), "حمو سعاد");
t("تاريخ ميلاد في آخره", cleanName("قاسمي يوسف 12/03/2008"), "قاسمي يوسف");
t("مجموع ليس اسمًا", cleanName("المجموع"), "");
t("أستاذ ليس اسمًا", cleanName("الأستاذ: فلان"), "");
t("رأس عمود", cleanName("اللقب والاسم"), "");
t("رقم وحده", cleanName("17"), "");
t("اسم يبدأ بكلمة تشبه العنوان لا يُحذف", cleanName("اسماء بن علي"), "اسماء بن علي");
t("الهمزات تبقى كما كُتبت", cleanName("أمينة إبراهيم"), "أمينة إبراهيم");

console.log("— اللصق");
{
  const r = cleanPastedText("1. بن عمر أمين\n2. حمو سعاد\n\n3- قاسمي يوسف\nالمجموع 3");
  t("ترقيم وأسطر فارغة ومجموع", r.names, ["بن عمر أمين", "حمو سعاد", "قاسمي يوسف"]);
  t("المحذوف يُعدّ", r.dropped, 1);
}
{
  const r = cleanPastedText("1\tبن عمر\tأمين\t12/03/2008\tذكر\n2\tحمو\tسعاد\t01/01/2008\tأنثى");
  t("أعمدة منسوخة من Excel: لقب واسم دون تاريخ وجنس", r.names, ["بن عمر أمين", "حمو سعاد"]);
}
{
  const r = cleanPastedText("حمو سعاد\nحمو  سعاد\nعيسى رضا");
  t("المكرّر يُعرض ولا يُحذف", [r.names.length, r.repeated], [3, ["حمو سعاد"]]);
}

console.log("— ورقة الإشراف التربوي");
{
  const grid = [
    [],
    [null, null, null, null, null, null, null, null, "القسم: 1 ج م ع ت 2"],
    [], [], [], [],
    ["الرقم", "رقم التعريف", "اللقب والاسم", "تاريخ الميلاد"],
    ...NAMES.slice(0, 3).map((n, i) => [String(i + 1), "x", n, "2008-01-01"]),
  ];
  const r = parseSheetGrid(grid, "Sheet1");
  t("الطريقة والقسم", [r?.how, r?.cls], ["ministry", "1 ج م ع ت 2"]);
  t("الأسماء", r?.names, NAMES.slice(0, 3));
}

console.log("— رأس اللقب والاسم");
{
  const grid = [
    ["ثانوية رمضان حمود"],
    ["القسم: أولى علوم 3"],
    [],
    ["الرقم", "الاسم", "اللقب", "اسم الأب", "تاريخ الميلاد"],
    ["1", "أمين", "بن عمر", "محمد", "12/03/2008"],
    ["2", "سعاد", "حمو", "علي", "01/01/2008"],
    ["", "", "المجموع", "", ""],
  ];
  const r = parseSheetGrid(grid, "ورقة1");
  t("طريقة الرأس والقسم", [r?.how, r?.cls], ["header", "أولى علوم 3"]);
  t("اللقب قبل الاسم ولو سبقه عمود الاسم، واسم الأب مستبعد", r?.names, ["بن عمر أمين", "حمو سعاد"]);
}
{
  const grid = [["اللقب والاسم"], ["بن عمر أمين"], ["حمو سعاد"], ["قاسمي يوسف"]];
  const r = parseSheetGrid(grid, "2 ع ت");
  t("عمود واحد بعنوان، واسم القسم من اسم الورقة", [r?.how, r?.cls, r?.names.length], ["header", "2 ع ت", 3]);
}

console.log("— بلا رأس");
{
  const grid = NAMES.map((n, i) => [i + 1, n, i % 2 ? "أنثى" : "ذكر", `0${i + 1}/05/2008`]);
  const r = parseSheetGrid(grid, "Sheet1");
  t("عمود الأسماء وحده دون الجنس والتواريخ", [r?.how, r?.names], ["column", NAMES]);
  t("اسم الورقة العام لا يصير اسم قسم", r?.cls, "");
}
{
  const grid = NAMES.map((n, i) => [String(i + 1), n.split(" ").slice(0, -1).join(" "), n.split(" ").slice(-1)[0]]);
  const r = parseSheetGrid(grid, "ف1");
  t("لقب واسم في عمودين متجاورين بلا رأس", r?.names, NAMES);
}

console.log("— ما يُترك للذكاء الاصطناعي");
t("ورقة أرقام", parseSheetGrid([[1, 2, 3], [4, 5, 6]], "x"), null);
t("أربعة أسماء بلا رأس لا تكفي", parseSheetGrid(NAMES.slice(0, 4).map((n) => [n]), "x"), null);
t("ورقة فارغة", sheetIsEmpty([[], [null, ""], [" "]]), true);
t("ورقة فيها شيء ليست فارغة", sheetIsEmpty([[], ["س"]]), false);

console.log("— النصّ المُرسل");
t("صفوف فارغة تُحذف والفواصل تُنظَّف", gridToCsv([["أ,ب", "ج"], [], [null, null], ["د", "", ""]]), "أ ب,ج\nد");
t("القصّ عند الحدّ", gridToCsv(Array.from({ length: 20000 }, (_, i) => [`اسم رقم ${i}`])).length <= MAX_SHEET_CSV, true);

console.log(`\n${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail ? 1 : 0);
