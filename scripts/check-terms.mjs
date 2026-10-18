/* اختبار الفصل الجاري بالتاريخ (src/lib/terms.ts) بمواعيد الأستاذ.
   يحتاج Node 22.6 فأحدث مع --experimental-strip-types. */
import { currentTerm } from "../src/lib/terms.ts";

let pass = 0, fail = 0;
function t(name, got, want) {
  if (got === want) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${got}\n       want ${want}`); }
}
const at = (m, d) => new Date(2026, m - 1, d);

console.log("— الفصل الأول: سبتمبر إلى ديسمبر");
t("1 سبتمبر", currentTerm(at(9, 1)), 1);
t("أكتوبر", currentTerm(at(10, 18)), 1);
t("31 ديسمبر", currentTerm(at(12, 31)), 1);
console.log("— الفصل الثاني: جانفي إلى مارس");
t("1 جانفي", currentTerm(at(1, 1)), 2);
t("فيفري", currentTerm(at(2, 14)), 2);
t("31 مارس", currentTerm(at(3, 31)), 2);
console.log("— الفصل الثالث: أفريل إلى منتصف جوان");
t("1 أفريل", currentTerm(at(4, 1)), 3);
t("ماي", currentTerm(at(5, 20)), 3);
t("15 جوان", currentTerm(at(6, 15)), 3);
console.log("— العطلة");
t("16 جوان", currentTerm(at(6, 16)), null);
t("جويلية", currentTerm(at(7, 10)), null);
t("31 أوت", currentTerm(at(8, 31)), null);

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
