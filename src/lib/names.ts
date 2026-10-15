/**
 * توحيد الاسم العربي قبل مقارنته أو البحث فيه.
 *
 * الهمزات والألف المقصورة والتاء المربوطة تُكتب بأشكال مختلفة لنفس التلميذ،
 * في ملفّين مختلفين أو في ضغطة الأستاذ على لوحة الهاتف. فلو قورنت حرفيًا
 * لسقط نصف القسم من المطابقة، ولما وجد الأستاذ من يبحث عنه.
 */
export function normalizeName(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * هل يطابق الاسمُ ما كُتب في خانة البحث؟
 *
 * كل كلمة مكتوبة يجب أن توجد في الاسم، ولا يلزم ترتيبها: «أمين عمر» تجد
 * «بن عمر أمين». فالأستاذ يتذكّر الاسم أو اللقب، نادرًا ما يتذكّر ترتيبهما.
 */
export function nameMatches(name: string, query: string): boolean {
  const target = normalizeName(name);
  const words = normalizeName(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  return words.every((word) => target.includes(word));
}
