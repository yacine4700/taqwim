/* اختبار قرار زرّ الرجوع (src/lib/backAction.ts).
   الورقة الإلزامية لا يغلقها الرجوع ولا يُخرج منها من التطبيق.
   يستورد الشفرة الحقيقية. يحتاج Node 22.6 فأحدث مع --experimental-strip-types. */
import { backAction } from "../src/lib/backAction.ts";

let passed = 0, failed = 0;
function t(name, got, want) {
  const ok = got === want;
  if (ok) passed++; else failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `\n        got  ${got}\n        want ${want}`}`);
}

console.log("— بلا ورقة إلزامية (السلوك كما كان)");
t("لا طبقات: الرجوع يُخرج من التطبيق", backAction({ own: 0, depth: 0, blocked: false }), "exit");
t("طبقة مفتوحة: الرجوع يغلقها", backAction({ own: 0, depth: 1, blocked: false }), "close");
t("حدث أطلقناه نحن بـ history.go: يُتجاهل", backAction({ own: 1, depth: 1, blocked: false }), "own");

console.log("— ورقة إلزامية مفتوحة");
t("وحدها: الرجوع لا يغلقها ولا يُخرج", backAction({ own: 0, depth: 1, blocked: true }), "stay");
t("فوق طبقات أخرى: تبقى كلها", backAction({ own: 0, depth: 3, blocked: true }), "stay");
t("حدث أطلقناه نحن يُتجاهل حتى لو كانت مفتوحة", backAction({ own: 1, depth: 1, blocked: true }), "own");
t("أُغلقت: يعود الرجوع إلى سلوكه", backAction({ own: 0, depth: 1, blocked: false }), "close");

console.log(`\n${passed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
