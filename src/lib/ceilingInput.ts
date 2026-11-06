/**
 * خانة «العلامة القصوى» في الإعدادات: ما يُقرأ منها وكيف تُحفظ.
 *
 * العلامة القصوى تغيّر معنى كل ما سُجّل بها، فلا تُحفظ إلا بتأكيد صريح، ولا يعتمد
 * التأكيد على مفتاح في لوحة المفاتيح (لوحة الأرقام العشرية في iPhone بلا Return):
 *  - زرّ «تم» الظاهر بجانب الخانة، أو Enter اختصارًا: يحفظ إن صحّت القيمة.
 *  - Escape: يُلغي المسودة ويعيد المحفوظ.
 *  - فقد التركيز، وإغلاق لوحة المفاتيح، وإخفاء الصفحة، ومغادرتها: لا تحفظ شيئًا
 *    ولا تمحو ما كُتب؛ تبقى المسودة في الخانة ظاهرًا أنها لم تُحفظ حتى يؤكّدها.
 *    وهذا هو ما يجعل الانتقال من الخانة إلى زرّ «تم» آمنًا: الـblur لا يفعل شيئًا
 *    قبل أن يصل الضغط.
 * وأي قيمة لا تصحّ عند التأكيد لا تُحفظ، وتبقى مكتوبة ليصحّحها الأستاذ.
 * والتأكيد المتكرّر لقيمة أُرسلت للحفظ (Enter ثم الزرّ) لا يحفظ مرة ثانية.
 *
 * لا علاقة لهذا الملف بالحساب: يقرأ نصًّا ويُرجع رقمًا أو لا شيء.
 */

/**
 * ما يُقبل كتابةً: أكبر من صفر وحتى 20، بخانتين عشريتين. هذا ما كانت تقبله
 * الواجهة قبل التحسينات، وما تقبله القاعدة من جهة الصغر (ceiling > 0، numeric(5,2)).
 */
export const CEILING_MAX = 20;

/** يقرأ ما كتبه الأستاذ: أرقام عربية وفارسية وفاصلة عشرية بأي شكل. */
export function parseCeilingText(raw: string): number | null {
  let t = raw.trim();
  if (!t) return null;
  t = t
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,،٫]/g, ".");
  // «4.» و«.5» مقبولتان وهو يكتب؛ «4.5.1» و«4a» و«-2» و«1e3» لا.
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const value = Number(t);
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

export type CeilingDecision =
  | { kind: "save"; value: number }
  | { kind: "same"; value: number }
  | { kind: "invalid" };

/**
 * ماذا يُفعل بالنص عند التأكيد، والمحفوظ الآن `saved`.
 *
 * الحدّان (أكبر من 0، وحتى 20) يحكمان ما يُكتب الآن لا ما حُفظ من قبل. القاعدة
 * تقبل أي علامة قصوى أكبر من صفر بخانتين عشريتين (numeric(5,2)) وقد تحمل قيمةً
 * فوق 20 من خارج الواجهة. لمس خانتها دون تغيير القيمة ليس تغييرًا ولا خطأً:
 * يُقارَن النص بالمحفوظ أولًا، ثم يُفحص المدى.
 */
export function decideCeiling(text: string, saved: number): CeilingDecision {
  const value = parseCeilingText(text);
  if (value === null) return { kind: "invalid" };
  if (value === Number(Number(saved).toFixed(2))) return { kind: "same", value };
  // «0.004» تُقرَّب إلى 0.00 فلا تصحّ: يجب أن تبقى أكبر من صفر بعد التقريب.
  if (!(value > 0) || value > CEILING_MAX) return { kind: "invalid" };
  return { kind: "save", value };
}

/** كيف يُعرض الرقم في الخانة: «4» لا «4.00». */
export function showCeiling(value: number): string {
  return String(Number(Number(value).toFixed(2)));
}

export type CeilingInputOptions = {
  /** القيمة المحفوظة الآن، تُقرأ عند كل تأكيد فلا تتقادم. */
  getSaved: () => number;
  onSave: (value: number) => void;
  /** أُكِّد ما كُتب ولا يصحّ: بقي مكتوبًا ولم يُحفظ، فليُنبَّه الأستاذ. */
  onInvalid: () => void;
  /** بدأ يكتب من جديد: يزول التنبيه. */
  onEdit: () => void;
  /** تغيّرت حالة التحرير: في التركيز، أو فيها مسودة لم تُؤكَّد. منها يظهر زرّ «تم». */
  onState?: (state: CeilingEditState) => void;
};

export type CeilingEditState = { focused: boolean; dirty: boolean };

/**
 * "saved": أُرسلت قيمة جديدة للحفظ. "same": لا تغيير فلا حفظ. "invalid": لا تصحّ فلم تُحفظ.
 * "duplicate": القيمة نفسها أُرسلت قبل قليل ولم يصل المحفوظ بعد، فلا إرسال ثانٍ.
 */
export type CeilingConfirm = "saved" | "same" | "invalid" | "duplicate";

export type CeilingController = {
  /** يؤكّد ما في الخانة: ما يفعله «تم» وEnter. */
  confirm: () => CeilingConfirm;
  /** يلغي المسودة ويعيد المحفوظ: ما يفعله Escape. */
  cancel: () => void;
  detach: () => void;
};

/**
 * يربط الخانة بقواعدها.
 * بلا React عمدًا: ليُختبر في متصفح حقيقي بنصّ الشفرة نفسه.
 */
export function attachCeilingInput(el: HTMLInputElement, opts: CeilingInputOptions): CeilingController {
  let focused = false;
  // آخر قيمة أُرسلت للحفظ. المحفوظ يصل من الأب بعد قليل (وقد يُسأل الأستاذ قبلها)،
  // وفي الأثناء لا تُرسَل القيمة نفسها مرة ثانية ولا تُعدّ المسودة غير مؤكَّدة.
  // تُمحى حين تُعاد الخانة من جديد (المفتاح في الأب) بعد الحفظ أو رفضه.
  let submitted: number | null = null;
  let last = "";

  const isDirty = () => {
    const saved = Number(Number(opts.getSaved()).toFixed(2));
    const value = parseCeilingText(el.value);
    return !(value !== null && (value === saved || value === submitted));
  };
  const emit = () => {
    const state: CeilingEditState = { focused, dirty: isDirty() };
    const key = `${state.focused}|${state.dirty}`;
    if (key === last) return;
    last = key;
    opts.onState?.(state);
  };

  const confirm = (): CeilingConfirm => {
    const saved = Number(opts.getSaved());
    const decision = decideCeiling(el.value, saved);
    let result: CeilingConfirm;
    if (decision.kind === "invalid") {
      // تبقى المسودة مكتوبة والتركيز عليها ليصحّحها.
      opts.onInvalid();
      if (!focused) el.focus();
      emit();
      return "invalid";
    }
    if (decision.kind === "same") {
      el.value = showCeiling(saved);
      result = "same";
    } else if (decision.value === submitted) {
      el.value = showCeiling(decision.value);
      result = "duplicate";
    } else {
      submitted = decision.value;
      el.value = showCeiling(decision.value);
      opts.onSave(decision.value);
      result = "saved";
    }
    // أُغلقت لوحة المفاتيح: في iPhone لا يأخذ الزرّ التركيز عند لمسه فتبقى مفتوحة.
    if (focused) el.blur();
    emit();
    return result;
  };

  const cancel = () => {
    submitted = null;
    el.value = showCeiling(Number(opts.getSaved()));
    if (focused) el.blur();
    emit();
  };

  const onFocus = () => {
    focused = true;
    el.select();
    emit();
  };
  // لا يُحفظ شيء ولا يُمحى شيء عند فقد التركيز: الأستاذ قد يكون في طريقه إلى «تم».
  const onBlur = () => {
    focused = false;
    emit();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // لوحة تركيب (IME) تستعمل Enter لإنهاء التركيب لا للتأكيد.
    if (e.isComposing) return;
    // keyCode 13: لوحات مفاتيح أندرويد القديمة تُرسل «تم» بلا key.
    if (e.key === "Enter" || e.keyCode === 13) {
      e.preventDefault();
      confirm();
    } else if (e.key === "Escape") {
      cancel();
    }
  };

  const onInput = () => {
    opts.onEdit();
    emit();
  };

  el.addEventListener("focus", onFocus);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("blur", onBlur);
  el.addEventListener("input", onInput);
  emit();
  return {
    confirm,
    cancel,
    detach: () => {
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("input", onInput);
    },
  };
}
