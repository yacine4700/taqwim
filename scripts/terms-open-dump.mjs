/* يطبع لكل يوم من 2026-07-01 إلى 2027-12-31 الفصول المفتوحة بحسب src/lib/terms.ts،
   بالصيغة نفسها التي يطبعها استعلام private.term_open، ليقارنهما scripts/check-term-guard.sh.
   الرزنامة تُقرأ من القاعدة (stdin: سطور school_year|term|starts_on|ends_on|grace_days). */
import { termView, addDays } from "../src/lib/terms.ts";
import { readFileSync } from "node:fs";

const rows = readFileSync(0, "utf8").trim().split("\n").filter(Boolean).map((l) => {
  const [school_year, term, starts_on, ends_on, grace_days] = l.split("|");
  return { school_year, term: Number(term), starts_on, ends_on, grace_days: Number(grace_days) };
});
for (let d = "2026-07-01"; d <= "2027-12-31"; d = addDays(d, 1)) {
  const v = termView(rows, d);
  console.log(`${d}|${[1, 2, 3].filter((t) => v.terms[t].open).join(",")}`);
}
