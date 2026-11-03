// اختبار src/lib/aiQuota.ts (تفسير جواب حدّ قراءة Gemini). قاعدة الحدّ نفسها في check-ai-quota.sh.
import { quotaVerdict } from "../src/lib/aiQuota.ts";

let ok = 0, bad = 0;
const eq = (label, got, want) => {
  if (got === want) ok++;
  else { bad++; console.log(`FAIL ${label}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }
};

let v = quotaVerdict({ ok: true, remaining: 7 }, null);
eq("مقبول", v.allow, true);
eq("الباقي", v.remaining, 7);

v = quotaVerdict({ ok: false, scope: "teacher", limit: 20 }, null);
eq("حدّ الأستاذ يمنع", v.allow, false);
eq("رمز 429", v.status, 429);
eq("الرسالة تذكر العدد", v.message.includes("20"), true);
eq("الرسالة تدلّ على البديل", v.message.includes("اكتب") || v.message.includes("كتابة"), true);

v = quotaVerdict({ ok: false, scope: "global", limit: 200 }, null);
eq("الحدّ العام يمنع", v.allow, false);
eq("الحدّ العام لا يذكر 200 للأستاذ", v.message.includes("200"), false);

v = quotaVerdict(null, { code: "PGRST202", message: "Could not find the function" });
eq("دالة غائبة: تمضي", v.allow, true);
eq("دالة غائبة: تُعلَّم", v.note, "missing");

v = quotaVerdict(null, { code: "57014", message: "timeout" });
eq("عطل: تمضي", v.allow, true);
eq("عطل: يُعلَّم", v.note, "error");

eq("جواب فارغ: تمضي", quotaVerdict(null, null).allow, true);
eq("جواب غريب: تمضي", quotaVerdict({ x: 1 }, null).allow, true);
eq("ok غير منطقي: تمضي", quotaVerdict({ ok: "no" }, null).allow, true);
eq("نصّ: تمضي", quotaVerdict("ok", null).allow, true);

console.log(`aiquota: ${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
