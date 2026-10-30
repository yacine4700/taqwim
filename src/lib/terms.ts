/**
 * الفصل الجاري، ومتى يُفتح الفصل للتنقيط ومتى يُقفل.
 *
 * المرجع رزنامة الفصول في القاعدة (public.term_calendar): لكل فصل بداية ونهاية
 * ومهلة بعد النهاية (10 أيام). الفصل مفتوح للكتابة من أول يوم فيه حتى نهايته +
 * مهلته. وكل فصل يبدأ في اليوم التالي لنهاية سابقه، فتتداخل مهلة الفصل مع بداية
 * اللاحق، ويُنقَّط الاثنان معًا في تلك الأيام.
 *
 * هذا المنطق مكتوب مرتين عن قصد — هنا للواجهة (لتعطيل الأزرار وكتابة التنبيه)
 * وفي private.term_open للقاعدة (وهي الحَكَم) — ويجب أن تبقى النسختان متطابقتين.
 * وإن اختلفتا (ساعة هاتف خاطئة مثلًا) رفضت القاعدة الكتابة وبقيت العملية في الطابور
 * ظاهرة بسببها، ولا تضيع علامة.
 *
 * ولا يُقفل شيء إن لم تغطِّ الرزنامة اليوم (لا صفوف، أو بعد آخر فصل بأكثر من 30
 * يومًا): نسيان رزنامة السنة القادمة لا يحبس الأساتذة خارج تطبيقهم. وحينها يرجع
 * الفصل الجاري إلى الحساب بالشهر (currentTerm) كما كان.
 */

export type TermNo = 1 | 2 | 3;

/** صفّ من public.term_calendar كما يصل من الخادم. التواريخ ISO (YYYY-MM-DD). */
export type TermRow = {
  school_year: string;
  term: number;
  starts_on: string;
  ends_on: string;
  grace_days: number;
};

/**
 * الحساب بالشهر، احتياطًا حين لا رزنامة:
 *   سبتمبر ← ديسمبر: الأول، جانفي ← مارس: الثاني، أفريل ← منتصف جوان: الثالث،
 *   وبعده حتى أوت عطلة: لا فصل جاريًا.
 */
export function currentTerm(date: Date): TermNo | null {
  const month = date.getMonth() + 1; // 1..12
  if (month >= 9) return 1;
  if (month <= 3) return 2;
  if (month <= 5) return 3;
  if (month === 6 && date.getDate() <= 15) return 3;
  return null;
}

/** تاريخ اليوم بتوقيت الجزائر (YYYY-MM-DD)، كما يحسبه الخادم، لا بمنطقة الهاتف. */
export function algiersToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** ISO + عدد أيام، بالتقويم الميلادي بلا منطقة زمنية فلا يؤثّر التوقيت الصيفي. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** عدد الأيام من a إلى b (موجب إن كان b بعد a). */
export function daysBetween(a: string, b: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

export type TermPhase =
  /** بين بدايته ونهايته. */
  | "current"
  /** انتهى وما تزال مهلته سارية: مفتوح للكتابة، مع تنبيه. */
  | "grace"
  /** لم يبدأ بعد: مقفل. */
  | "upcoming"
  /** انتهى ومهلته: مقفل، للاطلاع فقط. */
  | "closed"
  /** لا رزنامة تغطي اليوم: مفتوح ولا يُقال شيء. */
  | "unchecked";

export type TermStatus = {
  open: boolean;
  phase: TermPhase;
  /** أيام المهلة المتبقية حين phase = grace؛ 0 تعني اليوم آخر يوم. */
  graceLeft: number | null;
  /** آخر يوم يُقبل فيه التنقيط (نهاية الفصل + مهلته). */
  closesOn: string | null;
};

export type TermView = {
  /** الرزنامة تغطي اليوم فيُطبَّق القفل. */
  enforced: boolean;
  /** الفصل الذي يُفتح عليه التطبيق عند الدخول. */
  landing: TermNo;
  terms: Record<TermNo, TermStatus>;
};

const TERMS: TermNo[] = [1, 2, 3];

/** آخر يوم يُنقَّط فيه الفصل. */
export function closesOn(row: TermRow): string {
  return addDays(row.ends_on, row.grace_days);
}

export function termView(rows: readonly TermRow[], today: string): TermView {
  const open: TermStatus = { open: true, phase: "unchecked", graceLeft: null, closesOn: null };
  const unchecked = (): TermView => {
    const fallback = currentTerm(new Date(`${today}T12:00:00`));
    return {
      enforced: false,
      landing: fallback ?? 3,
      terms: { 1: open, 2: open, 3: open },
    };
  };

  if (rows.length === 0) return unchecked();
  const lo = rows.reduce((m, r) => (r.starts_on < m ? r.starts_on : m), rows[0].starts_on);
  const hi = addDays(
    rows.reduce((m, r) => (closesOn(r) > m ? closesOn(r) : m), closesOn(rows[0])),
    30,
  );
  if (today < lo || today > hi) return unchecked();

  const terms = {} as Record<TermNo, TermStatus>;
  for (const t of TERMS) {
    const row = rows.find((r) => r.term === t && today >= r.starts_on && today <= closesOn(r));
    if (row) {
      const inside = today <= row.ends_on;
      terms[t] = {
        open: true,
        phase: inside ? "current" : "grace",
        graceLeft: inside ? null : daysBetween(today, closesOn(row)),
        closesOn: closesOn(row),
      };
      continue;
    }
    const upcoming = rows.some((r) => r.term === t && today < r.starts_on);
    terms[t] = { open: false, phase: upcoming ? "upcoming" : "closed", graceLeft: null, closesOn: null };
  }

  // يُفتح على الفصل الجاري؛ وفي أيام تداخل المهلة الأحدث؛ وفي العطلة آخر فصل انتهى.
  const current = TERMS.filter((t) => terms[t].phase === "current");
  const opened = TERMS.filter((t) => terms[t].open);
  const ended = [...rows]
    .filter((r) => r.ends_on < today)
    .sort((a, b) => (a.ends_on < b.ends_on ? 1 : -1))[0];
  const landing: TermNo =
    current[current.length - 1] ??
    opened[opened.length - 1] ??
    ((ended?.term as TermNo | undefined) ?? 1);

  return { enforced: true, landing, terms };
}

/** نصّ الخطأ الذي يرفض به الخادم الكتابة في فصل مقفل: term_closed:<الفصل>. */
export function closedTermOf(message: string | null | undefined): TermNo | null {
  const m = /term_closed:([123])/.exec(message ?? "");
  return m ? (Number(m[1]) as TermNo) : null;
}

const ORDINAL: Record<TermNo, string> = { 1: "الأول", 2: "الثاني", 3: "الثالث" };

export function termName(t: number): string {
  return `الفصل ${ORDINAL[t as TermNo] ?? t}`;
}

const DAYS_AR = (n: number) =>
  n === 1 ? "يوم واحد" : n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يومًا`;

/**
 * ما يُقال للأستاذ على الفصل المعروض، أو null إن لم يكن ما يُقال.
 * `tone`: "info" مهلة بعيدة، "warn" في آخر 3 أيام، "closed" للفصل المقفل.
 */
export function termNotice(
  t: number,
  view: TermView,
): { text: string; tone: "info" | "warn" | "closed" } | null {
  const s = view.terms[t as TermNo];
  if (!s || !view.enforced) return null;
  if (s.phase === "grace" && s.graceLeft !== null) {
    const left =
      s.graceLeft === 0
        ? "اليوم آخر يوم لتنقيطه"
        : `يُغلق تنقيطه بعد ${DAYS_AR(s.graceLeft)}`;
    return {
      text: `انتهى ${termName(t)}. ${left}، ثم يصير للاطلاع فقط.`,
      tone: s.graceLeft <= 3 ? "warn" : "info",
    };
  }
  if (s.phase === "upcoming") {
    return { text: `${termName(t)} لم يبدأ بعد، فلا تنقيط فيه الآن. يُفتح في موعده.`, tone: "closed" };
  }
  if (s.phase === "closed") {
    return { text: `${termName(t)} مغلق: للاطلاع والطبع فقط.`, tone: "closed" };
  }
  return null;
}
