/**
 * قراءة قائمة تلاميذ من صورة.
 *
 * الأستاذ يملك ورقة القسم مطبوعة أو مكتوبة بخطّ اليد، فيصوّرها بهاتفه بدل
 * أن يكتب ستّة وثلاثين اسمًا. والقراءة تجري هنا في الخادم لا في المتصفّح
 * لسبب واحد: مفتاح Gemini سرّ، ولو وُضع في صفحة تُحمَّل على الهاتف لقرأه
 * كل من فتح الصفحة واستُنزف حساب الأستاذ.
 *
 * وللملفات بابٌ ثانٍ (sheets): الواجهة تقرأ ما تفهمه الشفرة من أوراق Excel
 * بنفسها، وما عجزت عنه ورقةٌ بعينها يصل هنا نصًّا فيقرؤه Gemini. الصورة
 * تأتي بابًا أول لأن الشفرة لا تقرأ الصور.
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

/** حدّ المجموع بعد الترميز. الواجهة تصغّر الصور قبل الإرسال، وهذا حارس أخير. */
const MAX_BASE64 = 12 * 1024 * 1024;

/** ورقة القسم صفحتان على الأكثر. */
const MAX_IMAGES = 2;

/** حدود الأوراق النصّية (يطابقها src/lib/rosterParse.ts): ورقة تتجاوزها لا قائمة تلاميذ فيها. */
const MAX_SHEETS = 12;
const MAX_SHEET_CSV = 60_000;
const MAX_ALL_CSV = 300_000;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

const PROMPT = `هذه صور قائمة تلاميذ قسم في ثانوية جزائرية: ورقة مطبوعة أو مكتوبة بخطّ اليد. وقد تكون صورتين لصفحتين من القائمة نفسها، فاقرأهما بالترتيب واجمع أسماءهما في قائمة واحدة متّصلة.

استخرج:
1. اسم القسم إن كان مكتوبًا في الصورة (مثل: أولى ثانوي جذع مشترك علوم وتكنولوجيا 3). إن لم يكن مكتوبًا فاتركه فارغًا.
2. أسماء التلاميذ بالترتيب الذي تظهر به.

قواعد لازمة:
- انسخ كل اسم كما هو مكتوب بالعربية حرفًا بحرف. لا تصحّح إملاءً ولا تُكمل اسمًا ناقصًا ولا تغيّر همزة.
- اللقب والاسم في سطر واحد كما في الورقة.
- احذف أرقام الترتيب وتواريخ الميلاد وأرقام التعريف والملاحظات ورؤوس الجدول: الأسماء وحدها.
- لا تخترع اسمًا أبدًا. ما لم تستطع قراءته اتركه خارج القائمة.
- لا تكرّر اسمًا ظهر في الصفحتين معًا (كأن يكون سطرًا مقطوعًا بينهما).
- إن لم تكن الصور قائمة تلاميذ فأرجع قائمة فارغة.`;

const SHEETS_PROMPT = `هذه أوراق من ملف Excel لأستاذ في ثانوية جزائرية، كل ورقة نصًّا بخلاياها مفصولة بفاصلة. بعضها قائمة تلاميذ قسم، وبعضها لا (جداول علامات أو غيرها). كل ورقة مسبوقة بسطر «### اسم الورقة».

لكل ورقة فيها قائمة تلاميذ أرجع:
1. sheet: اسم الورقة كما كُتب بعد ### بالحرف.
2. class_name: اسم القسم إن كان مكتوبًا في الورقة (مثل: أولى ثانوي جذع مشترك علوم وتكنولوجيا 3). إن لم يكن مكتوبًا فاتركه فارغًا.
3. students: أسماء التلاميذ بالترتيب الذي تظهر به.

قواعد لازمة:
- انسخ كل اسم كما هو مكتوب بالعربية حرفًا بحرف. لا تصحّح إملاءً ولا تُكمل اسمًا ناقصًا ولا تغيّر همزة.
- اللقب والاسم في سطر واحد (اللقب أولًا). إن كانا في عمودين فاجمعهما.
- احذف أرقام الترتيب وتواريخ الميلاد وأرقام التعريف والجنس والملاحظات ورؤوس الجدول والمجاميع: الأسماء وحدها.
- لا تخترع اسمًا أبدًا.
- الورقة التي ليست قائمة تلاميذ لا تُرجعها.`;

type Parsed = { class_name?: unknown; students?: unknown };

type ParsedSheets = { sheets?: unknown };

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
      "القراءة بالذكاء الاصطناعي غير مُفعَّلة: مفتاح Gemini غير مضبوط في إعدادات النشر. اكتب الأسماء بيدك.",
      503,
    );
  }

  let body: { images?: unknown; sheets?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("طلب غير مفهوم.");
  }

  if (Array.isArray(body.sheets)) return readSheets(key, body.sheets);

  const raw = Array.isArray(body.images) ? body.images : [];
  const images = raw
    .slice(0, MAX_IMAGES)
    .map((item) => {
      const part = item as { data?: unknown; mime?: unknown };
      return {
        data: typeof part.data === "string" ? part.data : "",
        mime: typeof part.mime === "string" ? part.mime : "image/jpeg",
      };
    })
    .filter((part) => part.data.length > 0);

  if (!images.length) return badRequest("لا صورة في الطلب.");
  if (images.some((part) => !ALLOWED.has(part.mime))) {
    return badRequest("صيغة الصورة غير مدعومة.");
  }
  const total = images.reduce((sum, part) => sum + part.data.length, 0);
  if (total > MAX_BASE64) return badRequest("الصور كبيرة. صوّرها بدقّة أقل.");

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(50_000),
      body: JSON.stringify({
        contents: [
          {
            // الصور أولًا ثم التعليمات: الصفحتان تُقرآن في طلب واحد فيرى
            // النموذج القائمة كاملة، ولا يُدفع ثمن التعليمات مرتين.
            parts: [
              ...images.map((part) => ({
                inline_data: { mime_type: part.mime, data: part.data },
              })),
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


/**
 * أوراق Excel نصًّا. المخطّط ملزم كما في الصور: تُقرأ الإجابة آليًا.
 * اسم الورقة يرجع كما أُرسل، والواجهة تطابق به ما أرسلته.
 */
async function readSheets(key: string, raw: unknown[]) {
  const sent = raw
    .slice(0, MAX_SHEETS)
    .map((item) => {
      const part = item as { name?: unknown; csv?: unknown };
      return {
        name: typeof part.name === "string" ? part.name.replace(/[\r\n]+/g, " ").trim().slice(0, 120) : "",
        csv: typeof part.csv === "string" ? part.csv.slice(0, MAX_SHEET_CSV) : "",
      };
    })
    .filter((part) => part.name && part.csv.trim());
  if (!sent.length) return badRequest("لا أوراق في الطلب.");
  if (sent.reduce((sum, part) => sum + part.csv.length, 0) > MAX_ALL_CSV) {
    return badRequest("الملف كبير. جرّب ملفًا أصغر أو أرسل أقسامه على دفعات.");
  }

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
              { text: SHEETS_PROMPT },
              ...sent.map((part) => ({ text: `### ${part.name}\n${part.csv}` })),
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              sheets: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    sheet: { type: "STRING" },
                    class_name: { type: "STRING" },
                    students: { type: "ARRAY", items: { type: "STRING" } },
                  },
                  required: ["sheet", "students"],
                },
              },
            },
            required: ["sheets"],
          },
          temperature: 0,
        },
      }),
    });
  } catch {
    return badRequest("تعذّر الوصول إلى خدمة القراءة. أعد المحاولة.", 502);
  }
  if (!response.ok) {
    const status = response.status === 429 ? 429 : 502;
    return badRequest(
      status === 429
        ? "خدمة القراءة مشغولة الآن. أعد المحاولة بعد قليل."
        : "تعذّرت قراءة الملف. أعد المحاولة أو اكتب الأسماء.",
      status,
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const parsed = parseJson(text) as ParsedSheets | null;
  if (!parsed || !Array.isArray(parsed.sheets)) {
    return badRequest("لم أفهم ما في الملف. جرّب ملفًا أوضح.", 422);
  }

  const known = new Set(sent.map((part) => part.name));
  const sheets = parsed.sheets
    .map((item) => {
      const part = item as { sheet?: unknown; class_name?: unknown; students?: unknown };
      return {
        sheet: typeof part.sheet === "string" ? part.sheet.trim() : "",
        cls: typeof part.class_name === "string" ? part.class_name.trim() : "",
        names: Array.isArray(part.students)
          ? part.students
              .map((n) => (typeof n === "string" ? n.replace(/\s+/g, " ").trim() : ""))
              .filter((n) => n.length > 1)
          : [],
      };
    })
    // ورقة لم نرسلها لا تُقبل: النموذج قد يخترع اسمًا فيضيع الربط
    .filter((part) => known.has(part.sheet) && part.names.length > 0);

  return Response.json({ sheets });
}
