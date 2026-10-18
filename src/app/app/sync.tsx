"use client";

import { isDurable } from "@/lib/localdb";
import { countWord, opStudentId, pending, pendingLabel, type Op } from "@/lib/outbox";

/** «منذ ثلاث دقائق» — الأستاذ يحتاج أن يعرف كم عمر ما يراه. */
export function since(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return "قبل لحظات";
  if (minutes < 60) return `منذ ${countWord(minutes, "دقيقة", "دقيقتين", "دقائق", "دقيقة")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `منذ ${countWord(hours, "ساعة", "ساعتين", "ساعات", "ساعة")}`;
  return `منذ ${countWord(Math.round(hours / 24), "يوم", "يومين", "أيام", "يومًا")}`;
}

/**
 * مؤشّر الإرسال في رأس الشاشة.
 *
 * لا يُعرض رقمٌ إلا إن كان هناك ما ينتظر فعلًا: الأستاذ في الحصة يحتاج أن
 * يعرف بنظرة أن علاماته وصلت، لا أن يقرأ شريط حالة دائمًا.
 */
export function SyncBadge({
  waiting, online, sending, label, onClick,
}: {
  waiting: ReturnType<typeof pending>;
  online: boolean;
  sending: boolean;
  label: string;
  onClick: () => void;
}) {
  const tone = waiting.blocked ? "bad" : !online ? "off" : waiting.total ? "busy" : "ok";
  const title = waiting.blocked
    ? `${label} — منها ${waiting.blocked} متعثّرة`
    : waiting.total
      ? online
        ? `${label} — جارٍ الإرسال`
        : `${label} — ستُرسل عند عودة الشبكة`
      : online
        ? "كل ما أدخلته محفوظ في الخادم"
        : "دون اتصال، ولا شيء ينتظر الإرسال";

  return (
    <button
      className={`sync ${tone}${sending ? " busy-now" : ""}`}
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {tone === "ok" ? (
          <path d="M20 6L9 17l-5-5" />
        ) : tone === "off" ? (
          <path d="M4 4l16 16M7 18h9a4 4 0 00.9-7.9A6 6 0 008 8.6" />
        ) : tone === "bad" ? (
          <path d="M12 8v5M12 16.5v.01M12 3l9 17H3z" />
        ) : (
          <path d="M12 16V8m0 0l-3 3m3-3l3 3M7 18h9a4 4 0 100-8 6 6 0 00-11.3 1.5A3.5 3.5 0 006 18h1" />
        )}
      </svg>
      {waiting.total > 0 && <span className="num">{waiting.total}</span>}
    </button>
  );
}

function opWho(op: Op): string {
  return opStudentId(op) ?? "";
}

function opWhat(op: Op): string {
  switch (op.kind) {
    case "record":
      return `علامات الفصل ${op.term}`;
    case "reading-add":
      return `محاولة قراءة ${op.reading.score}`;
    case "reading-del":
      return "حذف محاولة قراءة";
    case "student":
      return "بيانات التلميذ";
    case "tp-session":
      return `حصة أعمال تطبيقية ${op.session.held_on.slice(5)}`;
    case "tp-mark":
      return op.absent ? "غياب في حصة أعمال تطبيقية" : op.score === null ? "مسح علامة أعمال تطبيقية" : `علامة أعمال تطبيقية ${op.score}`;
  }
}

/**
 * قائمة ما لم يصل الخادم بعد: باسم التلميذ ووقت إدخاله.
 *
 * وجودها هو ما يجعل الطابور أمانًا لا صندوقًا أسود: الأستاذ يرى بعينه أن
 * العشرين علامة لم تضع، ويقرّر في المتعثّر منها.
 */
export function PendingSheet({
  queue, waiting, online, sending, lastSyncedAt, nameOf,
  onClose, onFlush, onRetry, onDiscard,
}: {
  queue: Op[];
  waiting: ReturnType<typeof pending>;
  online: boolean;
  sending: boolean;
  lastSyncedAt: number | null;
  nameOf: (studentId: string) => string;
  onClose: () => void;
  onFlush: () => void;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>{waiting.total ? pendingLabel(queue) : "كل شيء محفوظ"}</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className="lead">
          {!online
            ? "لا اتصال الآن. ما أدخلته محفوظ في الجهاز ويُرسل وحده عند عودة الشبكة — ولو أُغلق التطبيق."
            : sending
              ? "جارٍ الإرسال…"
              : waiting.total
                ? "في الطريق إلى الخادم."
                : lastSyncedAt
                  ? `آخر إرسال ${since(lastSyncedAt)}.`
                  : "لا شيء ينتظر الإرسال."}
        </p>

        {waiting.total > 0 && isDurable() === false && (
          <div className="note warn">
            هذا المتصفّح لا يسمح بالحفظ في الجهاز (نافذة خاصة غالبًا)، فما ينتظر
            الإرسال يضيع بإغلاق التطبيق. أبقِه مفتوحًا حتى تعود الشبكة.
          </div>
        )}

        {waiting.blocked > 0 && (
          <div className="note bad">
            {waiting.blocked} منها رفضها الخادم ولن تنجح بإعادة المحاولة وحدها —
            غالبًا لأن التلميذ حُذف. راجعها أدناه.
          </div>
        )}

        {queue.length > 0 && (
          <div className="plist">
            {queue.map((op) => (
              <div key={op.id} className={op.blocked ? "prow bad" : "prow"}>
                <div className="k">
                  <b>{op.kind === "tp-session" ? "حصة جديدة" : nameOf(opWho(op))}</b>
                  <small>
                    {opWhat(op)} · {since(op.at)}
                  </small>
                  {op.blocked && op.error && <small className="perr">{op.error}</small>}
                </div>
                {op.blocked ? (
                  <div className="pacts">
                    <button className="clearb" onClick={() => onRetry(op.id)}>أعد</button>
                    <button className="clearb danger" onClick={() => onDiscard(op.id)}>تجاهل</button>
                  </div>
                ) : (
                  <span className="pill">{op.tries > 0 ? `محاولة ${op.tries}` : "ينتظر"}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {waiting.total > 0 && online && (
          <button className="btn" style={{ marginTop: 14 }} onClick={onFlush} disabled={sending}>
            {sending ? "جارٍ الإرسال…" : "أرسل الآن"}
          </button>
        )}
      </div>
    </>
  );
}
