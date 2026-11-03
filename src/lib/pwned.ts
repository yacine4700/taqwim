/**
 * فحص كلمة السر في قاعدة كلمات السر المسرَّبة (Have I Been Pwned).
 *
 * بديل عن خيار «Prevent use of leaked passwords» في Supabase، المقفل في الخطة
 * المجانية. لا تخرج كلمة السر من الجهاز: تُحسب بصمتها SHA-1 ويُرسل أول 5 أحرف
 * منها فقط، فيعيد الخادم كل البصمات التي تبدأ بها (مئات)، ونبحث نحن عن الباقي.
 * ورأس Add-Padding يجعل حجم الجواب لا يكشف شيئًا.
 *
 * الفحص في المتصفّح، فهو حماية للأستاذ من كلمة سر ضعيفة لا قفل أمني: من يكلّم
 * Supabase مباشرة يتجاوزه. الحدّ الأدنى للطول يفرضه الخادم.
 *
 * إن تعذّر الفحص (لا شبكة، الخدمة معطّلة، مهلة) يُترك الأستاذ يكمل: لا يُمنع
 * من إنشاء حساب أو استعادة كلمته بسبب خدمة خارجية.
 */

export const PWNED_RANGE = "https://api.pwnedpasswords.com/range/";
export const PWNED_TIMEOUT_MS = 4000;

export const PWNED_MESSAGE =
  "كلمة السر هذه ظهرت في تسريبات بيانات معروفة، فيجرّبها المخترقون أولًا. اختر كلمة أخرى.";

export async function sha1Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** عدد مرات ظهور البصمة في جواب range. سطور الحشو عددها 0 فلا تُحتسب. */
export function countInRange(body: string, suffix: string): number {
  const want = suffix.toUpperCase();
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    if (line.slice(0, colon).toUpperCase() !== want) continue;
    const n = Number.parseInt(line.slice(colon + 1), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * عدد مرات تسريب كلمة السر، أو null إن تعذّر الفحص.
 * null لا يعني «سليمة»، يعني «لم نعرف»، والمنادي يتركه يمرّ.
 */
export async function pwnedCount(
  password: string,
  fetcher: Fetcher = (url, init) => fetch(url, init),
  timeoutMs: number = PWNED_TIMEOUT_MS,
): Promise<number | null> {
  if (!password) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const hash = await sha1Hex(password);
    const response = await fetcher(PWNED_RANGE + hash.slice(0, 5), {
      headers: { "Add-Padding": "true" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    return countInRange(await response.text(), hash.slice(5));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** رسالة المنع إن كانت مسرَّبة، وإلا null (ومنها تعذّر الفحص). */
export async function leakedPasswordProblem(
  password: string,
  fetcher?: Fetcher,
  timeoutMs?: number,
): Promise<string | null> {
  const count = await pwnedCount(password, fetcher, timeoutMs);
  return count !== null && count > 0 ? PWNED_MESSAGE : null;
}
