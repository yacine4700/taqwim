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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { kvGet, kvSet } from "@/lib/localdb";
import { backoff, enqueue, isPermanent, type Op } from "@/lib/outbox";

type Supabase = ReturnType<typeof createClient>;

type SendResult = { ok: boolean; permanent: boolean; message: string };

const OK: SendResult = { ok: true, permanent: false, message: "" };

export type Outbox = {
  queue: Op[];
  /** قُرئ الطابور المحفوظ من الجهاز. قبلها لا نكتب فوقه. */
  ready: boolean;
  online: boolean;
  sending: boolean;
  lastSyncedAt: number | null;
  push: (op: Op) => void;
  flush: () => void;
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

  const queueRef = useRef<Op[]>([]);
  const flushingRef = useRef(false);
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
          const { error } = await supabase.from("records").upsert(
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
          return error
            ? { ok: false, permanent: isPermanent(error.code), message: error.message }
            : OK;
        }

        if (op.kind === "reading-add") {
          // المعرّف مولَّد في الهاتف، فإعادة الإرسال لا تضاعف المحاولة.
          const { error } = await supabase.from("readings").upsert(
            {
              id: op.reading.id,
              teacher_id: teacherId,
              student_id: op.reading.student_id,
              term: op.reading.term,
              score: op.reading.score,
              read_on: op.reading.read_on,
            },
            { onConflict: "id" },
          );
          return error
            ? { ok: false, permanent: isPermanent(error.code), message: error.message }
            : OK;
        }

        if (op.kind === "reading-del") {
          const { error } = await supabase
            .from("readings")
            .delete()
            .eq("id", op.reading_id);
          return error
            ? { ok: false, permanent: isPermanent(error.code), message: error.message }
            : OK;
        }

        const { error } = await supabase
          .from("students")
          .update(op.patch)
          .eq("id", op.student_id);
        return error
          ? { ok: false, permanent: isPermanent(error.code), message: error.message }
          : OK;
      } catch (problem) {
        // استثناء من fetch نفسه: الشبكة، لا الخادم.
        const message = problem instanceof Error ? problem.message : "تعذّر الاتصال";
        return { ok: false, permanent: false, message };
      }
    },
    [supabase, teacherId],
  );

  const flush = useCallback(() => {
    void (async () => {
      if (flushingRef.current || !readyRef.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (!queueRef.current.some((op) => !op.blocked)) return;

      flushingRef.current = true;
      setSending(true);
      try {
        const round = queueRef.current.filter((op) => !op.blocked);
        for (const queued of round) {
          const live = queueRef.current.find((op) => op.id === queued.id);
          if (!live || live.blocked || live.nextTry > Date.now()) continue;

          inFlightRef.current = live.id;
          const result = await send(live);
          inFlightRef.current = null;

          if (result.ok) {
            // تُنقل إلى نسخة الخادم ثم تخرج من الطابور، فلا ترتجف الشاشة.
            appliedRef.current(live);
            setQ((q) => q.filter((op) => op.id !== live.id));
            continue;
          }

          if (result.permanent) {
            setQ((q) =>
              q.map((op) =>
                op.id === live.id
                  ? { ...op, blocked: true, error: result.message, tries: op.tries + 1 }
                  : op,
              ),
            );
            continue;
          }

          // الشبكة ساقطة: بقية الطابور ستسقط مثلها، فنتوقّف ونعيد لاحقًا.
          setQ((q) =>
            q.map((op) =>
              op.id === live.id
                ? {
                    ...op,
                    tries: op.tries + 1,
                    error: result.message,
                    nextTry: backoff(op.tries + 1, Date.now()),
                  }
                : op,
            ),
          );
          break;
        }
        if (!queueRef.current.some((op) => !op.blocked)) setLastSyncedAt(Date.now());
      } finally {
        inFlightRef.current = null;
        flushingRef.current = false;
        setSending(false);
      }
    })();
  }, [send, setQ]);

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

  return {
    queue,
    ready,
    online,
    sending,
    lastSyncedAt,
    push,
    flush,
    retry,
    discard,
    reset,
  };
}
