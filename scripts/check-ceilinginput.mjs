/* اختبار خانة العلامة القصوى (src/lib/ceilingInput.ts): ما يُقبل وما يُرفض، ثم متى يُحفظ ما كُتب
   (زرّ «تم» وEnter يحفظان مرة واحدة؛ Escape يلغي؛ فقد التركيز وإغلاق لوحة المفاتيح وإخفاء الصفحة
   ومغادرتها لا تحفظ ولا تمحو المسودة)
   بعنصر وهمي يُطلق الأحداث نفسها. اختبار المتصفح الحقيقي على المكوّن خارج المستودع.
   يحتاج --experimental-strip-types. */
import { parseCeilingText, decideCeiling, showCeiling, attachCeilingInput, CEILING_MAX } from "../src/lib/ceilingInput.ts";

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
}

console.log("— القراءة");
for (const [txt, want] of [
  ["4", 4], ["4.5", 4.5], ["4,5", 4.5], ["4،5", 4.5], ["٤٫٥", 4.5], ["٤", 4], ["۴", 4],
  [" 6 ", 6], ["3.", 3], [".5", 0.5], ["2.456", 2.46], ["20", 20], ["007", 7],
]) t(`«${txt}»`, parseCeilingText(txt), want);
for (const txt of ["", "  ", "abc", "4a", "-2", "+3", "4.5.1", "1e3", "1,2,3", "٤.٥.٦", "٤ ٥", "Infinity", "NaN", "0x10", "٤/٥"])
  t(`«${txt}» ← مرفوضة`, parseCeilingText(txt), null);

console.log("— القرار عند التأكيد (المحفوظ 4)");
t("قيمة جديدة", decideCeiling("5", 4), { kind: "save", value: 5 });
t("القيمة نفسها", decideCeiling("4", 4), { kind: "same", value: 4 });
t("القيمة نفسها بشكل آخر", decideCeiling("٤٫٠", 4), { kind: "same", value: 4 });
t("المحفوظ نصًّا من القاعدة", decideCeiling("4", "4.00"), { kind: "same", value: 4 });
t("أعلى حدّ", decideCeiling(String(CEILING_MAX), 4), { kind: "save", value: 20 });
for (const [txt, v] of [["0.01", 0.01], ["0.1", 0.1], ["0.5", 0.5], ["0.49", 0.49], ["4.5", 4.5], ["4,5", 4.5], ["٤٫٥", 4.5], ["٠٫٠١", 0.01], ["19.99", 19.99]])
  t(`«${txt}» تُقبل (أكبر من 0 وحتى 20)`, decideCeiling(txt, 4), { kind: "save", value: v });
for (const txt of ["0", "0.0", "0.00", "0.004", "٠", "20.01", "21", "100", "", "x", "-1"])
  t(`«${txt}» ← غير صالحة`, decideCeiling(txt, 4), { kind: "invalid" });

console.log("— القيم القديمة المحفوظة خارج المدى (القاعدة تقبل أي قيمة > 0)");
t("0.25 محفوظة وبقيت 0.25: لا تغيير ولا خطأ", decideCeiling("0.25", 0.25), { kind: "same", value: 0.25 });
t("0.1 محفوظة كنص من القاعدة", decideCeiling("0.1", "0.10"), { kind: "same", value: 0.1 });
t("25 محفوظة (خارج 20) وبقيت 25", decideCeiling("25", 25), { kind: "same", value: 25 });
t("0.25 محفوظة وكُتبت 0.3: قيمة صالحة جديدة تُحفظ", decideCeiling("0.3", 0.25), { kind: "save", value: 0.3 });
t("99.99 محفوظة (القاعدة تسمح) وبقيت: لا تغيير", decideCeiling("99.99", 99.99), { kind: "same", value: 99.99 });
t("99.99 محفوظة وكُتبت 30: جديدة فوق 20 فلا تُحفظ", decideCeiling("30", 99.99), { kind: "invalid" });
t("0.25 محفوظة وكُتبت 4: تُحفظ", decideCeiling("4", 0.25), { kind: "save", value: 4 });
t("4 محفوظة وكُتبت 0.25: تُحفظ (كان مقبولًا قبل التحسينات)", decideCeiling("0.25", 4), { kind: "save", value: 0.25 });
t("محفوظة بكسور زائدة 4.333 والنص المعروض 4.33: لا تغيير", decideCeiling("4.33", 4.333), { kind: "same", value: 4.33 });
t("قديمة 0.25 والنص فارغ: غير صالحة لا حفظ", decideCeiling("", 0.25), { kind: "invalid" });

console.log("— العرض");
t("4", showCeiling(4), "4");
t("4.5", showCeiling(4.5), "4.5");
t("4.50 من القاعدة", showCeiling("4.50"), "4.5");
t("2.46", showCeiling(2.456), "2.46");

console.log("— متى يُحفظ ما كُتب (عنصر وهمي بالأحداث نفسها)");
class FakeInput extends EventTarget {
  constructor(value) { super(); this.value = value; this.focused = false; }
  focus() { if (this.focused) return; this.focused = true; this.dispatchEvent(new Event("focus")); }
  blur() { if (!this.focused) return; this.focused = false; this.dispatchEvent(new Event("blur")); }
  select() {}
  type(v) { this.value = v; this.dispatchEvent(new Event("input")); }
  key(key, keyCode = 0, extra = {}) { const e = new Event("keydown", { cancelable: true }); e.key = key; e.keyCode = keyCode; Object.assign(e, extra); this.dispatchEvent(e); return e; }
}
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
/** الأب الحقيقي يحدّث المحفوظ بعد وصول الحفظ؛ `apply` يحاكي ذلك (وقد لا يصل أبدًا في الاتصال المقطوع). */
function rig(saved = 4) {
  const el = new FakeInput(showCeiling(saved));
  const log = { saves: [], invalid: 0, edit: 0, states: [] };
  const ctl = attachCeilingInput(el, {
    getSaved: () => saved,
    onSave: (v) => { log.saves.push(v); },
    onInvalid: () => log.invalid++,
    onEdit: () => log.edit++,
    onState: (s) => log.states.push(`${s.focused ? "F" : "-"}${s.dirty ? "D" : "-"}`),
  });
  return { el, log, ctl, apply: (v) => { saved = v; }, saved: () => saved };
}
const hide = () => { document.visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange")); document.visibilityState = "visible"; };
const leave = () => { hide(); window.dispatchEvent(new Event("pagehide")); window.dispatchEvent(new Event("beforeunload")); };
const state = (r) => ({ saves: r.log.saves, shown: r.el.value, invalid: r.log.invalid });
const last = (r) => r.log.states[r.log.states.length - 1];
let r;

console.log("  · «تم» وEnter");
r = rig(); r.el.focus(); r.el.type("5"); r.ctl.confirm();
t("زرّ «تم» يحفظ القيمة الصالحة", state(r), { saves: [5], shown: "5", invalid: 0 });
t("…ويغلق لوحة المفاتيح (الخانة تفقد التركيز)", r.el.focused, false);
r = rig(); r.el.focus(); r.el.type("5"); r.el.key("Enter", 13);
t("Enter يحفظ القيمة الصالحة", state(r), { saves: [5], shown: "5", invalid: 0 });
r = rig(); r.el.focus(); r.el.type("5"); r.el.key("Unidentified", 13);
t("«تم» على لوحة أندرويد بلا key (keyCode 13) يحفظ", state(r), { saves: [5], shown: "5", invalid: 0 });
r = rig(); r.el.focus(); r.el.type("٤٫٥"); r.ctl.confirm();
t("«٤٫٥» تُحفظ 4.5", state(r), { saves: [4.5], shown: "4.5", invalid: 0 });
r = rig(); r.el.focus(); r.el.type("5"); const ev = r.el.key("Enter", 13);
t("Enter لا يُرسَل إلى نموذج (preventDefault)", ev.defaultPrevented, true);
r = rig(); r.el.focus(); r.el.type("5"); r.el.key("Enter", 229, { isComposing: true });
t("Enter أثناء تركيب IME لا يؤكّد", state(r), { saves: [], shown: "5", invalid: 0 });

console.log("  · Escape");
r = rig(); r.el.focus(); r.el.type("5"); r.el.key("Escape");
t("Escape يلغي المسودة ويعيد المحفوظ", state(r), { saves: [], shown: "4", invalid: 0 });
t("…ولا يترك مسودة (لا زرّ «تم»)", last(r), "--");

console.log("  · فقد التركيز وإغلاق لوحة المفاتيح ومغادرة الصفحة: لا حفظ ولا محو");
r = rig(); r.el.focus(); r.el.type("5"); r.el.blur();
t("blur وحده لا يحفظ ولا يمحو المسودة", state(r), { saves: [], shown: "5", invalid: 0 });
t("…والمسودة ظاهرة (زرّ «تم» يبقى)", last(r), "-D");
r = rig(); r.el.focus(); r.el.type("5");
t("إغلاق لوحة المفاتيح (لا حدث على الخانة): لا حفظ ولا محو", state(r), { saves: [], shown: "5", invalid: 0 });
t("…والخانة في التركيز ومسودتها ظاهرة", last(r), "FD");
r = rig(); r.el.focus(); r.el.type("5"); hide();
t("إخفاء الصفحة لا يحفظ", state(r), { saves: [], shown: "5", invalid: 0 });
r = rig(); r.el.focus(); r.el.type("5"); leave();
t("مغادرة الصفحة (pagehide/beforeunload) دون تأكيد لا تحفظ", state(r), { saves: [], shown: "5", invalid: 0 });
r = rig(); r.el.focus(); r.el.type("5"); r.el.blur(); leave();
t("blur ثم مغادرة الصفحة: لا حفظ", state(r), { saves: [], shown: "5", invalid: 0 });
r = rig(); r.el.focus(); r.el.type("5"); r.el.blur(); r.el.focus(); r.el.type("6"); r.ctl.confirm();
t("تركيز جديد بعد blur: يؤكّد المكتوب الأخير", state(r), { saves: [6], shown: "6", invalid: 0 });

console.log("  · الانتقال إلى زرّ «تم»: blur ثم الضغط");
r = rig(); r.el.focus(); r.el.type("5"); r.el.blur(); r.ctl.confirm();
t("blur أولًا ثم ضغط «تم»: يحفظ ما كُتب", state(r), { saves: [5], shown: "5", invalid: 0 });
r = rig(); r.el.focus(); r.el.type("5"); r.el.blur();
t("وقت انتقال التركيز إلى الزرّ المسودة قائمة وزرّها ظاهر", last(r), "-D");

console.log("  · قيم غير صالحة");
for (const bad of ["99", "20.01", "0", "0.004", "", "abc", "-1", "4.5.1"]) {
  r = rig(); r.el.focus(); r.el.type(bad); const res = r.ctl.confirm();
  t(`«${bad}» لا تُحفظ وتبقى مكتوبة ويُنبَّه`, [res, state(r)], ["invalid", { saves: [], shown: bad, invalid: 1 }]);
}
r = rig(); r.el.focus(); r.el.type("99"); r.ctl.confirm();
t("بعد الرفض الخانة في التركيز ومسودتها قائمة ليصحّحها", [r.el.focused, last(r)], [true, "FD"]);
r.el.type("6"); r.ctl.confirm();
t("ثم تصحيحها وتأكيدها يحفظ", state(r), { saves: [6], shown: "6", invalid: 1 });
r = rig(); r.el.focus(); r.el.type("99"); r.el.blur(); r.ctl.confirm();
t("رفض بعد blur: لا حفظ، وتُعاد الخانة إلى التركيز", [state(r), r.el.focused], [{ saves: [], shown: "99", invalid: 1 }, true]);

console.log("  · لا حفظ مزدوج");
r = rig(); r.el.focus(); r.el.type("5"); r.el.key("Enter", 13); const again = r.ctl.confirm();
t("Enter ثم زرّ «تم» قبل أن يصل المحفوظ: حفظ واحد", [state(r).saves, again], [[5], "duplicate"]);
r = rig(); r.el.focus(); r.el.type("5"); r.ctl.confirm(); r.el.key("Enter", 13);
t("الزرّ ثم Enter: حفظ واحد", state(r).saves, [5]);
r = rig(); r.el.focus(); r.el.type("5"); r.ctl.confirm(); r.ctl.confirm(); r.ctl.confirm();
t("ضغطات متتالية على «تم»: حفظ واحد", state(r).saves, [5]);
r = rig(); r.el.focus(); r.el.type("5"); r.ctl.confirm(); r.apply(5); r.ctl.confirm();
t("وبعد وصول المحفوظ الجديد: لا حفظ (لا تغيير)", state(r).saves, [5]);
r = rig(); r.el.focus(); r.el.type("5"); r.ctl.confirm(); r.el.focus(); r.el.type("6"); r.ctl.confirm();
t("قيمة أخرى بعد الأولى تُحفظ (حفظان لقيمتين)", state(r).saves, [5, 6]);
r = rig(); r.el.focus(); r.el.type("5"); r.ctl.confirm();
t("بعد الحفظ لا مسودة معلّقة (يختفي زرّ «تم»)", last(r), "--");

console.log("  · لا تغيير");
r = rig(); r.el.focus(); r.el.type("4"); const same = r.ctl.confirm();
t("القيمة المحفوظة نفسها: لا حفظ ولا تنبيه", [same, state(r)], ["same", { saves: [], shown: "4", invalid: 0 }]);
r = rig(); r.el.focus(); r.el.type("٤٫٠");
t("«٤٫٠» تساوي المحفوظ فلا تُعدّ مسودة", last(r), "F-");
r = rig(); r.el.focus(); r.el.blur();
t("لمس الخانة دون كتابة ثم الخروج: لا شيء", [state(r), last(r)], [{ saves: [], shown: "4", invalid: 0 }, "--"]);
r = rig(25); r.el.focus(); r.ctl.confirm();
t("محفوظة قديمة (25) تُلمس وتُؤكَّد دون تغيير: لا حفظ ولا خطأ", state(r), { saves: [], shown: "25", invalid: 0 });
r = rig(0.25); r.el.focus(); r.el.blur();
t("محفوظة قديمة (0.25) تُلمس وتُترك: لا مسودة", last(r), "--");

console.log("  · حالة التحرير التي يبني عليها زرّ «تم»");
r = rig();
t("البداية: لا زرّ", last(r), "--");
r.el.focus();
t("التركيز وحده يُظهر الزرّ (لمستخدم iPhone قبل أن يكتب)", last(r), "F-");
r.el.type("5");
t("الكتابة: في التركيز ومسودة", last(r), "FD");
t("حدث الكتابة يُبلَّغ (يُزيل التنبيه القديم)", r.log.edit, 1);

console.log("  · فكّ الربط");
r = rig(); r.el.focus(); r.ctl.detach(); r.el.type("5"); r.el.key("Enter"); r.el.blur(); leave();
t("بعد فكّ الربط لا شيء يحدث", state(r), { saves: [], shown: "5", invalid: 0 });

console.log(`\n${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
