/* نسخة حرفية من منطق src/lib/roster.ts (ومن normalizeName في src/lib/names.ts)،
   لاختباره بالأرقام. النسختان يجب أن تبقيا متطابقتين. */

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

function splitNewNames(text, existing) {
  const known = new Set(existing.map(normalizeName));
  const seen = new Set();
  const fresh = [];
  const repeated = [];
  for (const line of text.split("\n")) {
    const name = line.replace(/\s+/g, " ").trim();
    if (name.length < 2) continue;
    const key = normalizeName(name);
    if (!key) continue;
    if (known.has(key) || seen.has(key)) repeated.push(name);
    else fresh.push(name);
    seen.add(key);
  }
  return { fresh, repeated };
}

function nextPositions(existing, count) {
  const last = existing.reduce((max, p) => (p > max ? p : max), 0);
  return Array.from({ length: count }, (_, i) => last + i + 1);
}

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`);
}

const cls = ["تلميذ أول", "سارة الأمين", "فاطمة"];

console.log("1. اسم واحد جديد");
t("يُضاف", splitNewNames("تلميذ ثاني", cls), { fresh: ["تلميذ ثاني"], repeated: [] });

console.log("2. عدّة أسماء وسطور فارغة وفراغات");
t("سطر لكل تلميذ، الفارغ يُترك، الفراغ يُوحَّد",
  splitNewNames("  اسم  أ  \n\n اسم ب\n \n", cls), { fresh: ["اسم أ", "اسم ب"], repeated: [] });
t("حرف واحد لا يكون اسمًا", splitNewNames("ا\nاسم ج", cls), { fresh: ["اسم ج"], repeated: [] });
t("علامات ترقيم وحدها تُترك", splitNewNames("--\n..", cls), { fresh: [], repeated: [] });
t("نصّ فارغ", splitNewNames("", cls), { fresh: [], repeated: [] });

console.log("3. الموجود في القسم يُعرض مكرّرًا لا يُحذف بصمت");
t("الاسم نفسه", splitNewNames("فاطمة", cls), { fresh: [], repeated: ["فاطمة"] });
t("بهمزة مختلفة", splitNewNames("سارة الامين", cls), { fresh: [], repeated: ["سارة الامين"] });
t("بتاء مربوطة مختلفة", splitNewNames("فاطمه", cls), { fresh: [], repeated: ["فاطمه"] });
t("ترتيب الكلمات مختلف = اسم آخر", splitNewNames("أول تلميذ", cls), { fresh: ["أول تلميذ"], repeated: [] });

console.log("4. المكرّر داخل اللصق نفسه");
t("الثاني مكرّر", splitNewNames("اسم د\nاسم  د", cls), { fresh: ["اسم د"], repeated: ["اسم د"] });

console.log("5. قسم فارغ");
t("كل شيء جديد", splitNewNames("أ ب\nج د", []), { fresh: ["أ ب", "ج د"], repeated: [] });

console.log("6. الترتيب بعد آخر تلميذ");
t("بعد 1..3", nextPositions([1, 2, 3], 2), [4, 5]);
t("فجوات بعد الحذف: بعد الأكبر", nextPositions([1, 7, 3], 1), [8]);
t("قسم فارغ يبدأ من 1", nextPositions([], 3), [1, 2, 3]);
t("لا شيء يُضاف", nextPositions([2], 0), []);

console.log(`\n${pass} ناجح · ${fail} فاشل`);
if (fail) process.exit(1);
