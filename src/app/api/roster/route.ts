/**
 * قراءة قائمة تلاميذ من صورة.
 *
 * الأستاذ يملك ورقة القسم مطبوعة أو مكتوبة بخطّ اليد، فيصوّرها بهاتفه بدل
 * أن يكتب ستّة وثلاثين اسمًا. والقراءة تجري هنا في الخادم لا في المتصفّح
 * لسبب واحد: مفتاح Gemini سرّ، ولو وُضع في صفحة تُحمَّل على الهاتف لقرأه
 * كل من فتح الصفحة واستُنزف حساب الأستاذ.
 *
 * ولا يُستجاب إلا لأستاذ داخل بجلسته: بغير ذلك يصير هذا المسار بابًا
 * مفتوحًا على حصّة Gemini يستعمله من شاء.
 */

import { createClient } from "@/lib/supabase/server";

/** قراءة صورة فيها ستّة وثلاثون اسمًا تتجاوز المهلة الافتراضية. */
export const maxDuration = 60;

/**
 * النموذج الافتراضي مجاني في الطبقة المجانية، وهو أدقّ ما يُعتمد عليه في خطّ
 * اليد. و GEMINI_MODEL يبدّله دون تعديل الشفرة — إن ضاقت الحصة مثلًا فـ
 * gemini-3.5-flash-lite أخفّ وهو مجاني كذلك.
 */
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** حدّ الصورة بعد الترميز. الواجهة تصغّرها قبل الإرسال، وهذا حارس أخير. */
const MAX_BASE64 = 8 * 1024 * 1024;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

const PROMPT = `هذه صورة قائمة تلاميذ قسم في ثانوية جزائرية: ورقة مطبوعة أو مكتوبة بخطّ اليد.

استخرج:
1. اسم القسم إن كان مكتوبًا في الصورة (مثل: أولى ثانوي جذع مشترك علوم وتكنولوجيا 3). إن لم يكن مكتوبًا فاتركه فارغًا.
2. أسماء التلاميذ بالترتيب الذي تظهر به.

قواعد لازمة:
- انسخ كل اسم كما هو مكتوب بالعربية حرفًا بحرف. لا تصحّح إملاءً ولا تُكمل اسمًا ناقصًا ولا تغيّر همزة.
- اللقب والاسم في سطر واحد كما في الورقة.
- احذف أرقام الترتيب وتواريخ الميلاد وأرقام التعريف والملاحظات ورؤوس الجدول: الأسماء وحدها.
- لا تخترع اسمًا أبدًا. ما لم تستطع قراءته اتركه خارج القائمة.
- إن لم تكن الصورة قائمة تلاميذ فأرجع قائمة فارغة.`;

type Parsed = { class_name?: unknown; students?: unknown };

function badRequest(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** يلتقط أول كائن JSON في النصّ، فالنموذج قد يلفّه بسياج شفرة. */
function parseJson(text: string): Parsed | null {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned) as Parsed;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as Parsed;
    } catch {
      return null;
    }
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return badRequest("سجّل الدخول أولًا.", 401);

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return badRequest(
      "قراءة الصور غير مُفعَّلة: مفتاح Gemini غير مضبوط في إعدادات النشر.",
      503,
    );
  }

  let body: { image?: unknown; mime?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("طلب غير مفهوم.");
  }

  const image = typeof body.image === "string" ? body.image : "";
  const mime = typeof body.mime === "string" ? body.mime : "image/jpeg";
  if (!image) return badRequest("لا صورة في الطلب.");
  if (!ALLOWED.has(mime)) return badRequest("صيغة الصورة غير مدعومة.");
  if (image.length > MAX_BASE64) return badRequest("الصورة كبيرة. صوّرها بدقّة أقل.");

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(50_000),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mime, data: image } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: {
          // مخطّط ملزم: الأسماء تُقرأ آليًا بعد ذلك، فلا تُترك صيغتها للصدفة.
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              class_name: { type: "STRING" },
              students: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["students"],
          },
          temperature: 0,
        },
      }),
    });
  } catch {
    return badRequest("تعذّر الوصول إلى خدمة القراءة. أعد المحاولة.", 502);
  }

  if (!response.ok) {
    // لا يُعاد نصّ الخطأ كما هو: قد يحمل تفاصيل المفتاح والمشروع.
    const status = response.status === 429 ? 429 : 502;
    return badRequest(
      status === 429
        ? "خدمة القراءة مشغولة الآن. أعد المحاولة بعد قليل."
        : "تعذّرت قراءة الصورة. أعد المحاولة أو الصق الأسماء.",
      status,
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const parsed = parseJson(text);
  if (!parsed) return badRequest("لم أفهم ما في الصورة. جرّب صورة أوضح.", 422);

  const names = Array.isArray(parsed.students)
    ? parsed.students
        .map((n) => (typeof n === "string" ? n.replace(/\s+/g, " ").trim() : ""))
        .filter((n) => n.length > 1)
    : [];
  const cls = typeof parsed.class_name === "string" ? parsed.class_name.trim() : "";

  return Response.json({ cls, names });
}
