"use client";

/**
 * الإرسال في الخلفية: يأخذ ما في الطابور ويحاول إيصاله إلى الخادم.
 *
 * ما يضمنه:
 * - لا تخرج عملية من الطابور إلا بعد أن يقبلها الخادم.
 * - فشل الشبكة يوقف الجولة ولا يُسقط شيئًا؛ تُعاد المحاولة بتباعد متزايد،
 *   وعند عودة الاتصال، وعند العودة إلى التطبيق.
 * - رفض الخادم النهائي (قيد أو صلاحية) يُعلَّم «متعثّرًا» ويُعرض على الأستاذ،
 *   فهو وحده من يقرّر إعادة المحاولة أو التجاهل.
 * - لا يُرسل شيء بلا جلسة لصاحب الطابور: الطلب بلا جلسة يذهب بدور anon،
 *   فيُرفض الإدخال، أما التعديل والحذف فـ«ينجحان» على صفر صفوف تحت RLS —
 *   فتخرج العملية من الطابور ولم يُحفظ شيء. لذلك يُتحقَّق من الجلسة قبل كل
 *   جولة، ويتوقّف الطابور حتى يعود الأستاذ إلى حسابه، ثم يُستأنف وحده.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { kvGet, kvSet } from "@/lib/localdb";
import { closedTermOf, termName } from "@/lib/terms";
import { afterFailure, classifyFailure, enqueue, mayFailSilently, writesBlocked, type Op } from "@/lib/outbox";
import { DEFAULT_READING_CODE } from "@/lib/scoring";

type Supabase = ReturnType<typeof createClient>;

/** ردّ الخادم كما هو، والتصنيف بعده في classifyFailure. */
type SendResult = {
  ok: boolean;
  message: string;
  code?: string | null;
  status?: number | null;
  thrown?: boolean;
  /** حكمٌ معروف بلا رمز من الخادم (تلميذ لم يعد موجودًا، عملية مجهولة). */
  kind?: "rejected";
};

const OK: SendResult = { ok: true, message: "" };

type PostgrestReply = {
  error: { code?: string; message: string } | null;
  status: number;
};

function reply({ error, status }: PostgrestReply): SendResult {
  return error ? { ok: false, message: error.message, code: error.code ?? null, status } : OK;
}

export type Outbox = {
  queue: Op[];
  /** قُرئ الطابور المحفوظ من الجهاز. قبلها لا نكتب فوقه. */
  ready: boolean;
  online: boolean;
  sending: boolean;
  lastSyncedAt: number | null;
  /**
   * الطابور متوقّف لأن الجلسة انتهت (أو صارت لحساب آخر). العمليات محفوظة
   * ولم تُعلَّم متعثّرة، وتُرسل وحدها بعد الدخول من جديد.
   */
  needsLogin: boolean;
  /** الحساب مجدول للحذف أو موقوف: لا يُرسل شيء حتى يُلغى ذلك، ولا يضيع شيء. */
  frozen: boolean;
  push: (op: Op) => void;
  /**
   * يرسل ما في الطابور. الوعد يتم حين تنتهي الجولة الجارية (أو لا شيء يُرسل)،
   * فمن يريد قراءةً بعد الإرسال ينتظره بدل أن يسابقه.
   */
  flush: () => Promise<void>;
  retry: (id: string) => void;
  discard: (id: string) => void;
  reset: () => void;
};

export function useOutbox(
  supabase: Supabase,
  teacherId: string,
  onApplied: (op: Op) => void,
): Outbox {
  const [queue, setQueue] = useState<Op[]>([]);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [sending, setSending] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  /** الحساب مجدول للحذف أو موقوف: الطابور محفوظ ومتوقّف حتى يُلغى ذلك. */
  const [frozen, setFrozen] = useState(false);

  const queueRef = useRef<Op[]>([]);
  const runRef = useRef<Promise<void> | null>(null);
  const inFlightRef = useRef<string | null>(null);
  const appliedRef = useRef(onApplied);
  const readyRef = useRef(false);
  appliedRef.current = onApplied;

  const key = `queue:${teacherId}`;

  /** الطابور يتغيّر داخل حلقة غير متزامنة، فالمرجع هو الأصل والحالة مرآته. */
  const setQ = useCallback((fn: (q: Op[]) => Op[]) => {
    queueRef.current = fn(queueRef.current);
    setQueue(queueRef.current);
  }, []);

  /* استرجاع ما لم يُرسل قبل إغلاق الصفحة */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const saved = await kvGet<Op[]>(key);
      if (!alive) return;
      if (Array.isArray(saved) && saved.length) setQ(() => saved);
      readyRef.current = true;
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [key, setQ]);

  useEffect(() => {
    if (!ready) return;
    void kvSet(key, queue);
  }, [queue, ready, key]);

  const send = useCallback(
    async (op: Op): Promise<SendResult> => {
      try {
        if (op.kind === "record") {
          if (op.changes) {
            // التغيير وحده، يدمجه الخادم في الصف القائم: لا يمحو ما لم تلمسه.
            const merged = await supabase.rpc("merge_record", {
              p_student_id: op.student_id,
              p_term: op.term,
              p_changes: op.changes,
              p_at: new Date(op.at).toISOString(),
            });
            if (merged.error?.message === "student_not_found") {
              return {
                ok: false,
                message: "التلميذ غير موجود في الخادم (ربما حُذف)",
                kind: "rejected",
              };
            }
            // الدالة غير موجودة بعد (الترحيل لم يُطبَّق): الإرسال القديم، صفًّا كاملًا.
            if (merged.error?.code !== "PGRST202") return reply(merged);
          }
          const answer = await supabase.from("records").upsert(
            {
              teacher_id: teacherId,
              student_id: op.student_id,
              term: op.term,
              criteria: op.criteria,
              tp: op.tp,
              devoir: op.devoir,
              exam: op.exam,
              updated_at: new Date(op.at).toISOString(),
            },
            { onConflict: "student_id,term" },
          );
          return reply(answer);
        }

        if (op.kind === "reading-add") {
          // المعرّف مولَّد في الهاتف، فإعادة الإرسال لا تضاعف المحاولة.
          const answer = await supabase.from("readings").upsert(
            {
              id: op.reading.id,
              teacher_id: teacherId,
              student_id: op.reading.student_id,
              term: op.reading.term,
              score: op.reading.score,
              read_on: op.reading.read_on,
              // عملية سبقت التحديث بلا كود تُعامَل كمحاولة معيار القراءة، كما تفعل القاعدة.
              criterion_code: op.reading.criterion_code ?? DEFAULT_READING_CODE,
            },
            { onConflict: "id" },
          );
          return reply(answer);
        }

        if (op.kind === "reading-del") {
          const answer = await supabase
            .from("readings")
            .delete()
            .eq("id", op.reading_id);
          return reply(answer);
        }

        if (op.kind === "tp-session") {
          // المعرّف مولَّد في الهاتف، فإعادة الإرسال لا تضاعف الحصة.
          const answer = await supabase.from("tp_sessions").upsert(
            {
              id: op.session.id,
              teacher_id: teacherId,
              class_id: op.session.class_id,
              group_id: op.session.group_id,
              term: op.session.term,
              held_on: op.session.held_on,
              title: op.session.title,
            },
            { onConflict: "id" },
          );
          return reply(answer);
        }

        if (op.kind === "tp-mark") {
          // «مسح»: الصف يُحذف فيعود التلميذ «لم يُقيَّم»، ولا يُترك صف فارغ.
          if (op.score === null && !op.absent) {
            const answer = await supabase
              .from("tp_marks")
              .delete()
              .eq("session_id", op.session_id)
              .eq("student_id", op.student_id);
            return reply(answer);
          }
          const answer = await supabase.from("tp_marks").upsert(
            {
              teacher_id: teacherId,
              session_id: op.session_id,
              student_id: op.student_id,
              score: op.absent ? null : op.score,
              absent: op.absent,
              updated_at: new Date(op.at).toISOString(),
            },
            { onConflict: "session_id,student_id" },
          );
          return reply(answer);
        }

        if (op.kind === "student") {
          // التعديل تحت RLS لا يُرجع خطأً إن لم يجد الصف، فنطلب الصف المعدَّل:
          // صفر صفوف = التلميذ لم يعد في الخادم، لا «نجاح».
          const answer = await supabase
            .from("students")
            .update(op.patch)
            .eq("id", op.student_id)
            .select("id");
          if (!answer.error && (answer.data ?? []).length === 0) {
            return {
              ok: false,
              message: "التلميذ غير موجود في الخادم (ربما حُذف)",
              kind: "rejected",
            };
          }
          return reply(answer);
        }

        // نوع لا يعرفه هذا الإصدار (طابور كتبه إصدار أحدث): لا يُرسل على أنه
        // شيء آخر. يُعلَّم متعثّرًا فيراه الأستاذ ولا يُحذف من وراء ظهره.
        return { ok: false, message: "عملية غير معروفة", kind: "rejected" };
      } catch (problem) {
        // استثناء من fetch نفسه: الشبكة، لا الخادم.
        const message = problem instanceof Error ? problem.message : "تعذّر الاتصال";
        return { ok: false, message, thrown: true };
      }
    },
    [supabase, teacherId],
  );

  /**
   * جلسة صالحة لصاحب الطابور؟ "network" إن تعذّر التحقّق نفسه (لا نحكم على
   * الجلسة بانقطاع)، و"other" إن كانت الجلسة لحساب آخر فُتح في المتصفّح نفسه:
   * لا يُرسل طابور أستاذ باسم غيره.
   */
  const sessionState = useCallback(async (): Promise<"ok" | "none" | "other" | "network"> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) return "network";
      if (!data.session) return "none";
      return data.session.user.id === teacherId ? "ok" : "other";
    } catch {
      return "network";
    }
  }, [supabase, teacherId]);

  /**
   * هل الكتابة ممنوعة على هذا الحساب الآن (مهلة حذف أو إيقاف)؟ "network" إن
   * تعذّر السؤال: لا يُرسل ما قد يضيع بصمت حتى تُعرف الحالة. والدالة غير
   * موجودة (قبل الترحيل) تعني أنه لا تجميد أصلًا.
   */
  const accountState = useCallback(async (): Promise<"ok" | "frozen" | "network"> => {
    try {
      const { data, error } = await supabase.rpc("my_account_status");
      if (error) return error.code === "PGRST202" ? "ok" : "network";
      return writesBlocked(data) ? "frozen" : "ok";
    } catch {
      return "network";
    }
  }, [supabase]);

  const flush = useCallback((): Promise<void> => {
    // جولة جارية: من طلب الإرسال ينتظرها هي، ولا تبدأ جولة ثانية معها
    if (runRef.current) return runRef.current;
    if (!readyRef.current) return Promise.resolve();
    if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve();
    if (!queueRef.current.some((op) => !op.blocked)) return Promise.resolve();

    const run = (async () => {
      setSending(true);
      try {
        const session = await sessionState();
        if (session === "network") return;
        if (session !== "ok") {
          // لا نرسل شيئًا: العمليات تبقى كما هي، بلا محاولة تُحسب
          setNeedsLogin(true);
          return;
        }
        setNeedsLogin(false);

        const round = queueRef.current.filter((op) => !op.blocked);
        if (round.some(mayFailSilently)) {
          const state = await accountState();
          if (state === "network") return;
          if (state === "frozen") {
            setFrozen(true);
            return;
          }
          setFrozen(false);
        }
        for (const queued of round) {
          const live = queueRef.current.find((op) => op.id === queued.id);
          if (!live || live.blocked || live.nextTry > Date.now()) continue;

          inFlightRef.current = live.id;
          const result = await send(live);
          inFlightRef.current = null;

          if (result.ok) {
            setFrozen(false);
            // تُنقل إلى نسخة الخادم ثم تخرج من الطابور، فلا ترتجف الشاشة.
            appliedRef.current(live);
            setQ((q) => q.filter((op) => op.id !== live.id));
            continue;
          }

          let kind =
            result.kind ??
            classifyFailure({
              code: result.code,
              status: result.status,
              thrown: result.thrown,
              hasSession: true,
            });
          // 42501 والجلسة سليمة: رفضٌ للعملية، أو حساب مجمَّد؟ يُسأل الخادم.
          if (kind === "rejected" && result.code === "42501") {
            const state = await accountState();
            if (state === "frozen") kind = "frozen";
            else if (state === "network") kind = "network";
          }
          if (kind === "frozen") setFrozen(true);
          const message =
            kind === "auth"
              ? "انتهت الجلسة: تُرسل بعد الدخول من جديد"
              : kind === "frozen"
                ? "الحساب مجدول للحذف أو موقوف: تُرسل بعد الإلغاء"
                : closedTermOf(result.message) !== null
                  ? `${termName(closedTermOf(result.message)!)} أُغلق، فرفض الخادم هذه العلامة. تجاهلها من هنا.`
                  : result.message;
          let outcome: ReturnType<typeof afterFailure> | null = null;
          setQ((q) =>
            q.map((op) => {
              if (op.id !== live.id) return op;
              outcome = afterFailure(op, kind, message, Date.now());
              return outcome.op;
            }),
          );
          const decided = outcome as ReturnType<typeof afterFailure> | null;
          if (decided?.needsLogin) setNeedsLogin(true);
          if (decided?.stop ?? true) break;
        }
        if (!queueRef.current.some((op) => !op.blocked)) setLastSyncedAt(Date.now());
      } finally {
        inFlightRef.current = null;
        runRef.current = null;
        setSending(false);
      }
    })();
    runRef.current = run;
    return run;
  }, [send, sessionState, accountState, setQ]);

  const push = useCallback(
    (op: Op) => {
      setQ((q) => enqueue(q, op, inFlightRef.current));
      flush();
    },
    [flush, setQ],
  );

  const retry = useCallback(
    (id: string) => {
      setQ((q) =>
        q.map((op) =>
          op.id === id ? { ...op, blocked: false, error: null, tries: 0, nextTry: 0 } : op,
        ),
      );
      flush();
    },
    [flush, setQ],
  );

  const discard = useCallback(
    (id: string) => {
      setQ((q) => q.filter((op) => op.id !== id));
    },
    [setQ],
  );

  const reset = useCallback(() => {
    setQ(() => []);
  }, [setQ]);

  /* الاتصال: عودته هي أهمّ لحظة للإرسال */
  useEffect(() => {
    if (typeof window === "undefined") return;
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      flush();
    };
    const down = () => setOnline(false);
    const back = () => {
      if (document.visibilityState === "visible") {
        setOnline(navigator.onLine);
        flush();
      }
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    const timer = window.setInterval(flush, 10_000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
      window.clearInterval(timer);
    };
  }, [flush]);

  useEffect(() => {
    if (ready) flush();
  }, [ready, flush]);

  /*
   * عودة الجلسة (دخول من جديد، أو تجديد الرمز، أو فتح الصفحة) تستأنف
   * الطابور وحدها: لا زرّ «أعد» لكل علامة. وخروجها يوقفه قبل أن يُرسَل
   * شيء بلا جلسة.
   */
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setNeedsLogin(true);
        return;
      }
      if (session.user.id !== teacherId) {
        setNeedsLogin(true);
        return;
      }
      setNeedsLogin(false);
      // خارج نداء المستمع: supabase-js تنصح ألّا يُنتظر فيه نداء آخر للعميل
      window.setTimeout(flush, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, teacherId, flush]);

  return {
    queue,
    ready,
    online,
    sending,
    lastSyncedAt,
    needsLogin,
    frozen,
    push,
    flush,
    retry,
    discard,
    reset,
  };
}
