/**
 * منطق تبويب «الرزنامة» في لوحة المشرف بلا واجهة، ويُختبر بالأرقام (scripts/check-admin.mjs).
 * الحَكَم هو القاعدة (public.admin_set_term)؛ هنا فحص مسبق بالقواعد نفسها ليرى المشرف الخطأ
 * قبل الإرسال، وتحذيرات من رزنامة ناقصة أو فيها فجوات.
 *
 * ملف قائم بذاته (لا يستورد من terms.ts) ليُختبر دون محمِّل مسارات.
 */

export type AdminTermRow = {
  school_year: string;
  term: number;
  starts_on: string;
  ends_on: string;
  grace_days: number;
};

/** ما يكتبه المشرف في الحقول: نصوص كما هي. */
export type TermDraft = { starts_on: string; ends_on: string; grace_days: string; reason: string };

export const GRACE_DEFAULT = 10;
export const GRACE_MAX = 30;
const DAY = 86_400_000;

const ms = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(ms(s)) === s;

export function yearStart(school_year: string): number {
  return Number(school_year.split("/")[0]);
}

/** الفصول مجمَّعة بالسنة، الأحدث أولًا؛ كل سنة فيها ثلاث خانات (null إن غاب الفصل). */
export function groupByYear(rows: readonly AdminTermRow[]) {
  const years = [...new Set(rows.map((r) => r.school_year))].sort((a, b) => yearStart(b) - yearStart(a));
  return years.map((school_year) => ({
    school_year,
    terms: [1, 2, 3].map(
      (t) => rows.find((r) => r.school_year === school_year && r.term === t) ?? null,
    ),
  }));
}

/** اسم السنة التالية: بعد أحدث سنة في الجدول، أو سنة اليوم الدراسية إن كان فارغًا. */
export function nextYearLabel(rows: readonly AdminTermRow[], today: string): string {
  if (rows.length > 0) {
    const y = Math.max(...rows.map((r) => yearStart(r.school_year)));
    return `${y + 1}/${y + 2}`;
  }
  const [year, month] = today.split("-").map(Number);
  const y = month >= 9 ? year : year - 1;
  return `${y}/${y + 1}`;
}

/** تواريخ سنة جديدة مقترحة: تواريخ السنة السابقة مزاحةً بسنة. يعدّلها المشرف قبل الحفظ. */
export function suggestYear(rows: readonly AdminTermRow[], label: string): Array<TermDraft> {
  const prev = groupByYear(rows)[0];
  const shift = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return iso(Date.UTC(y + 1, m - 1, day));
  };
  const y1 = yearStart(label);
  const fallback = [
    [`${y1}-09-01`, `${y1}-12-17`],
    [`${y1}-12-18`, `${y1 + 1}-03-18`],
    [`${y1 + 1}-03-19`, `${y1 + 1}-07-08`],
  ];
  return [0, 1, 2].map((i) => {
    const row = prev?.terms[i];
    return {
      starts_on: row ? shift(row.starts_on) : fallback[i][0],
      ends_on: row ? shift(row.ends_on) : fallback[i][1],
      grace_days: String(row ? row.grace_days : GRACE_DEFAULT),
      reason: "",
    };
  });
}

/** «بلا مهلة» أو «يوم واحد» أو «3 أيام» أو «12 يومًا»، بصيغة العدد في العربية. */
export function graceWord(n: number): string {
  if (n <= 0) return "بلا مهلة";
  if (n === 1) return "مهلة يوم واحد";
  if (n === 2) return "مهلة يومين";
  return n <= 10 ? `مهلة ${n} أيام` : `مهلة ${n} يومًا`;
}

/** آخر يوم يُقبل فيه التنقيط في الفصل: نهايته + مهلته. */
export function closesOn(row: Pick<AdminTermRow, "ends_on" | "grace_days">): string {
  return iso(ms(row.ends_on) + row.grace_days * DAY);
}

export type TermCheck = { ok: true; grace: number } | { ok: false; error: string };

/** القواعد نفسها التي تفرضها public.admin_set_term. */
export function validateTerm(school_year: string, term: number, draft: TermDraft): TermCheck {
  if (!/^\d{4}\/\d{4}$/.test(school_year)) return { ok: false, error: "اسم السنة بصيغة 2027/2028" };
  const y1 = yearStart(school_year);
  if (Number(school_year.split("/")[1]) !== y1 + 1) {
    return { ok: false, error: "السنتان في الاسم يجب أن تكونا متتاليتين" };
  }
  if (![1, 2, 3].includes(term)) return { ok: false, error: "الفصل من 1 إلى 3" };
  if (!isIso(draft.starts_on) || !isIso(draft.ends_on)) {
    return { ok: false, error: "اكتب تاريخ البداية والنهاية" };
  }
  if (ms(draft.ends_on) < ms(draft.starts_on)) {
    return { ok: false, error: "النهاية قبل البداية" };
  }
  const g = draft.grace_days.trim();
  if (!/^\d+$/.test(g) || Number(g) > GRACE_MAX) {
    return { ok: false, error: `المهلة عدد أيام من 0 إلى ${GRACE_MAX}` };
  }
  if (ms(draft.starts_on) < Date.UTC(y1, 6, 1) || ms(draft.ends_on) > Date.UTC(y1 + 1, 8, 30)) {
    return { ok: false, error: `التواريخ خارج السنة الدراسية ${school_year} (من 1 جويلية ${y1} إلى 30 سبتمبر ${y1 + 1})` };
  }
  return { ok: true, grace: Number(g) };
}

/** خطأ القاعدة بعبارة المشرف، أو null إن لم يكن من أخطاء هذه الشاشة. */
export function termErrorMessage(error: { code?: string | null; message?: string | null } | null | undefined): string | null {
  if (!error) return null;
  if (error.code === "23P01") return "يتداخل هذا الفصل مع فصل آخر في الرزنامة. عدّل التواريخ.";
  if (error.code === "22023") return "رفضت القاعدة القيم المكتوبة. راجع التواريخ والمهلة.";
  return null;
}

/**
 * ما يستحق انتباه المشرف في الرزنامة. نصوص قصيرة، والقاعدة هي التي تمنع التداخل.
 * - فصل غائب من سنة.
 * - فجوة أيام بين فصلين: لا يُفتح فيها إلا ما بقي في مهلته (ومع مهلة 0 لا شيء).
 * - اليوم خارج ما تغطيه الرزنامة (فلا يُقفل شيء)، أو الصيف بلا رزنامة للسنة القادمة.
 */
export function calendarIssues(rows: readonly AdminTermRow[], today: string): string[] {
  const out: string[] = [];
  for (const y of groupByYear(rows)) {
    y.terms.forEach((t, i) => {
      if (!t) out.push(`السنة ${y.school_year}: الفصل ${i + 1} غير مُدخَل.`);
    });
    for (let i = 0; i < 2; i++) {
      const a = y.terms[i];
      const b = y.terms[i + 1];
      if (!a || !b) continue;
      const gap = Math.round((ms(b.starts_on) - ms(a.ends_on)) / DAY) - 1;
      if (gap > 0) {
        out.push(`السنة ${y.school_year}: ${gap} ${gap === 1 ? "يوم" : "أيام"} بين الفصل ${i + 1} والفصل ${i + 2} لا يغطيها فصل جديد.`);
      }
    }
  }
  if (rows.length === 0) {
    out.push("لا رزنامة: لا شيء يُقفل في التطبيق.");
    return out;
  }
  const lo = Math.min(...rows.map((r) => ms(r.starts_on)));
  const hi = Math.max(...rows.map((r) => ms(r.ends_on) + r.grace_days * DAY)) + 30 * DAY;
  const t = ms(today);
  if (t < lo || t > hi) {
    out.push("الرزنامة لا تغطي تاريخ اليوم: لا شيء يُقفل في التطبيق. أضف السنة الجارية.");
  } else {
    const month = Number(today.split("-")[1]);
    const lastEnd = Math.max(...rows.map((r) => ms(r.ends_on)));
    if (month >= 6 && month <= 8 && t > lastEnd) {
      out.push("لم تُضَف رزنامة السنة القادمة بعد. إن لم تُضَف قبل سبتمبر فلن يُقفل شيء.");
    }
  }
  return out;
}

export type TermLogDetail = {
  school_year?: string;
  term?: number;
  starts_on?: string;
  ends_on?: string;
  grace_days?: number;
  previous?: { starts_on: string; ends_on: string; grace_days: number } | null;
};

/** سطر السجلّ لتعديل الرزنامة: ما صار وما كان. */
export function termLogSummary(d: TermLogDetail | null | undefined): string {
  if (!d || d.term === undefined || !d.starts_on || !d.ends_on) return "";
  const now = `من ${d.starts_on} إلى ${d.ends_on} (${graceWord(d.grace_days ?? GRACE_DEFAULT)})`;
  const head = `${d.school_year ?? ""} · الفصل ${d.term}: ${now}`;
  return d.previous
    ? `${head}. كان: من ${d.previous.starts_on} إلى ${d.previous.ends_on} (${graceWord(d.previous.grace_days)})`
    : `${head}. فصل جديد`;
}
