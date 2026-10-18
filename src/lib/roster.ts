import { normalizeName } from "./names";

/**
 * إضافة تلاميذ إلى قسم قائم (scripts/check-roster.mjs نسخة حرفية منه).
 *
 * الأستاذ يلصق اسمًا أو عدّة أسماء، سطرًا لكل تلميذ. يُفصل فيها ما هو جديد
 * عمّا يبدو موجودًا: اسم في القسم بنفس الكتابة بعد التوحيد (الهمزات والتاء
 * المربوطة…)، أو مكرّر داخل اللصق نفسه. المكرّر لا يُحذف بصمت: قد يكون في
 * القسم تلميذان بالاسم نفسه حقًّا، فيُعرض ويقرّر الأستاذ.
 */
export function splitNewNames(
  text: string,
  existing: string[],
): { fresh: string[]; repeated: string[] } {
  const known = new Set(existing.map(normalizeName));
  const seen = new Set<string>();
  const fresh: string[] = [];
  const repeated: string[] = [];
  for (const line of text.split("\n")) {
    const name = line.replace(/\s+/g, " ").trim();
    if (name.length < 2) continue;
    const key = normalizeName(name);
    if (!key) continue;
    if (known.has(key) || seen.has(key)) repeated.push(name);
    else fresh.push(name);
    seen.add(key);
  }
  return { fresh, repeated };
}

/** ترتيب الوافدين: بعد آخر تلميذ في القسم، فلا يتغيّر ترتيب من سبقهم. */
export function nextPositions(existing: number[], count: number): number[] {
  const last = existing.reduce((max, p) => (p > max ? p : max), 0);
  return Array.from({ length: count }, (_, i) => last + i + 1);
}
