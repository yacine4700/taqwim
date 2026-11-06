/* عزل CSS الإعدادات (src/app/globals.css): ما كتبته تحسينات «التقويم» لا يغيّر القواعد العامة.
   الشاشات الأخرى (التصدير والطباعة والمجموعات والاستيراد والوثائق والقوائم وبطاقة التلميذ والمؤسسات)
   تستعمل .crit و.critop و.cname و.kinds و.btn.full و.sw؛ فتبقى قواعدها كما كانت في main حرفيًّا،
   وكل ما يخصّ الإعدادات تحت .scoringcard أو بفئة خاصة بها. اختبار المتصفح الذي يقارن الأنماط المحسوبة
   لتلك الشاشات بـ main خارج المستودع (harness/isolation.js). */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
}
const norm = (s) => s.replace(/\s+/g, " ").trim();

/** كل القواعد (تُفرد القواعد داخل @media أيضًا): [المحدِّد، المتن]. */
const rules = [];
for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) rules.push([norm(m[1]), norm(m[2])]);

// القواعد العامة كما كانت في main (متن كل قاعدة حرفيًّا، بترتيبها إن تكرّر المحدِّد).
const MAIN = {
 ".icbtn": [
  "width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--muted);"
 ],
 ".icbtn:hover": [
  "background: var(--surface-2);"
 ],
 ".crit": [
  "padding: 13px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 9px;"
 ],
 ".crit:last-of-type": [
  "border-bottom: 0;"
 ],
 ".crit.off": [
  "opacity: 0.55;"
 ],
 ".critop": [
  "display: flex; align-items: center; gap: 8px;"
 ],
 ".cname": [
  "flex: 1; min-width: 0; font-size: 14px; font-weight: 600; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px 10px;"
 ],
 ".icbtn.danger": [
  "color: var(--danger);"
 ],
 ".icbtn.danger:hover": [
  "background: var(--danger-soft);"
 ],
 ".icbtn svg": [
  "width: 17px; height: 17px;"
 ],
 ".kinds": [
  "display: flex; gap: 6px; flex-wrap: wrap;"
 ],
 ".kinds button": [
  "padding: 7px 11px; border-radius: 999px; background: var(--surface-2); font-size: 12px; font-weight: 600; border: 1px solid transparent; color: var(--muted);"
 ],
 ".kinds button[aria-pressed=\"true\"]": [
  "background: var(--primary); color: var(--on-primary); border-color: var(--primary);"
 ],
 ".sw": [
  "flex: none; width: 42px; height: 25px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); padding: 2px; display: flex;"
 ],
 ".sw i": [
  "width: 19px; height: 19px; border-radius: 50%; background: var(--faint); transition: transform 0.15s ease, background 0.15s ease;",
  "transition: none;"
 ],
 ".sw.on": [
  "background: var(--primary-soft); border-color: var(--primary);"
 ],
 ".sw.on i": [
  "background: var(--primary); transform: translateX(-17px);"
 ],
 ".btn.full": [
  "width: calc(100% - 26px); margin: 11px 13px 13px;"
 ],
 ".icbtn.on": [
  "background: var(--primary-soft); color: var(--primary);"
 ],
 ".doccard .btn.full": [
  "width: 100%; margin: 0;"
 ],
 ".thumb .icbtn": [
  "position: absolute; inset-block-start: 4px; inset-inline-end: 4px; width: 26px; height: 26px; background: var(--surface); box-shadow: var(--shadow);"
 ],
 ".thumb .icbtn svg": [
  "width: 14px; height: 14px;"
 ],
 ".cceil": [
  "flex: none; display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--faint);"
 ],
 ".cceil input": [
  "width: 58px; text-align: center; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 7px 4px; font-variant-numeric: tabular-nums;"
 ],
 ".cceil input:disabled": [
  "opacity: 0.5;"
 ]
};

console.log("— القواعد العامة كما في main");
let same = 0;
for (const [sel, bodies] of Object.entries(MAIN)) {
  const found = rules.filter(([s]) => s === sel).map((r) => r[1]);
  if (JSON.stringify(found) === JSON.stringify(bodies)) same++;
  else t(`«${sel}» كما كانت في main`, found, bodies);
}
t(`${Object.keys(MAIN).length} قاعدة عامة (.crit .critop .cname .kinds .btn.full .sw .icbtn .cceil) مطابقة لـ main`, same, Object.keys(MAIN).length);

console.log("— ما يخصّ الإعدادات مقيَّد بها");
const GLOBAL = [".crit", ".critop", ".cname", ".kinds", ".btn.full", ".sw", ".icbtn"];
// فئات خاصة بالإعدادات: وجود إحداها في المحدِّد يجعله خاصًّا بها.
const OWN = [".scoringcard", ".stackrow", ".kgrid", ".stack", ".helpsheet", ".helpdone", ".helpq", ".touch"];
const leaks = [];
for (const [sel] of rules) {
  for (const one of sel.split(",").map(norm)) {
    const touchesGlobal = GLOBAL.some((g) => new RegExp("(^|[\\s>+~])" + g.replace(/\./g, "\\.") + "(?![\\w-])").test(one));
    if (!touchesGlobal) continue;
    if (Object.keys(MAIN).some((k) => k.split(",").map(norm).includes(one))) continue; // قاعدة main نفسها
    if (OWN.some((o) => one.includes(o))) continue;
    leaks.push(one);
  }
}
t("لا قاعدة جديدة على الفئات العامة خارج الإعدادات", leaks, []);
t("لا :has() في قواعد الإعدادات الجديدة", rules.filter(([s]) => s.includes(":has(") && /\.(scoringcard|crit|critop|kinds|rule|cceil|sw|stackrow)\b/.test(s)).map((r) => r[0]), []);
t("كل محدِّد يذكر .scoringcard يبدؤه", rules.flatMap(([s]) => s.split(",").map(norm)).filter((s) => s.includes(".scoringcard") && !s.startsWith(".scoringcard")), []);

console.log(`\n${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
