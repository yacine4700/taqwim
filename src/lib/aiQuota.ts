/**
 * تفسير جواب public.consume_ai_quota (ترحيل 20261103200000_ai_quota).
 *
 * الحدّ يومي: 20 طلب قراءة بـ Gemini لكل أستاذ، و200 للتطبيق كله. يُحتسب الطلب
 * قبل إرساله إلى Gemini.
 *
 * إن غابت الدالة (PGRST202: ترحيل لم يُطبَّق) أو تعذّر النداء لأي سبب آخر تمضي
 * القراءة كما كانت قبل الحدّ: عطل في العدّاد لا يحرم الأستاذ من الاستيراد.
 * وحده الجواب الصريح ok:false يمنع.
 */

export type QuotaRpcError = { code?: string; message?: string } | null;

export type QuotaVerdict =
  | { allow: true; remaining: number | null; note?: "missing" | "error" }
  | { allow: false; status: 429; message: string };

export function quotaVerdict(data: unknown, error: QuotaRpcError): QuotaVerdict {
  if (error) {
    return { allow: true, remaining: null, note: error.code === "PGRST202" ? "missing" : "error" };
  }
  if (!data || typeof data !== "object") return { allow: true, remaining: null, note: "error" };
  const reply = data as { ok?: unknown; scope?: unknown; limit?: unknown; remaining?: unknown };
  if (reply.ok === true) {
    return { allow: true, remaining: typeof reply.remaining === "number" ? reply.remaining : null };
  }
  if (reply.ok !== false) return { allow: true, remaining: null, note: "error" };
  if (reply.scope === "global") {
    return {
      allow: false,
      status: 429,
      message: "خدمة القراءة بالذكاء الاصطناعي بلغت حدّها اليوم. أعد غدًا، أو اكتب الأسماء أو الصقها الآن.",
    };
  }
  const limit = typeof reply.limit === "number" ? reply.limit : 20;
  return {
    allow: false,
    status: 429,
    message: `بلغت حدّ القراءة بالذكاء الاصطناعي اليوم (${limit} قراءة). يتجدّد غدًا، وتستطيع الآن كتابة الأسماء أو لصقها، أو استيراد ملف Excel عادي.`,
  };
}
