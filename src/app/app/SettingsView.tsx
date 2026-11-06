"use client";

import { useEffect, useRef, useState } from "react";
import type { Persistence } from "@/lib/localdb";
import { countWord } from "@/lib/outbox";
import { checkTotal, type Component, type Criterion, type CriterionKind } from "@/lib/scoring";
import { explainKind, KIND_NAME, WALKTHROUGH } from "@/lib/criteriaHelp";
import { attachCeilingInput, CEILING_MAX, showCeiling, type CeilingController, type CeilingEditState } from "@/lib/ceilingInput";
import { Klass, Profile, School } from "./types";
import { ChangePasswordSheet } from "./RosterSheets";
import { ThemeButton } from "./parts";

const TP_PRESETS = ["الأعمال التطبيقية", "التعبير الشفوي"];

/**
 * الإعدادات ثلاثة أبواب لا صفحة واحدة طويلة.
 *
 * كانت المعايير والمركّبات والبيانات الشخصية والحساب في سياق واحد يُمرَّر
 * مئات البكسلات، وهي أشياء لا يجمعها شيء: الأولى تُضبط مرة في السنة وتمسّ
 * كل علامة، والثانية تُكتب مرة ولا تمسّ حسابًا.
 */
export function SettingsView({
  criteria, components, email, profile, schools, classes,
  onCriterion, resetTick, helpOpen, onHelp, onAddCriterion, onDeleteCriterion, onComponent, onProfile,
  onAddSchool, onRenameSchool, onDeleteSchool, onSignOut, onBackup, persistence, onPersist,
}: {
  criteria: Criterion[];
  components: Component[];
  email: string;
  profile: Profile;
  schools: School[];
  classes: Klass[];
  onCriterion: (id: string, patch: Partial<Criterion>) => void;
  /** يزيد حين يُرفض تغيير معلَّق، فتعود خانة السقف إلى قيمتها المحفوظة. */
  resetTick: number;
  /** نافذة «كيف تعمل؟»: حالتها في AppClient لتكون طبقة يغلقها زرّ الرجوع. */
  helpOpen: boolean;
  onHelp: (open: boolean) => void;
  onAddCriterion: () => void;
  onDeleteCriterion: (c: Criterion) => void;
  onComponent: (id: string, patch: Partial<Component>) => void;
  onProfile: (patch: Partial<Profile>) => void;
  onAddSchool: (name: string) => Promise<School | null>;
  onRenameSchool: (id: string, name: string) => void;
  onDeleteSchool: (school: School) => void;
  onSignOut: () => void;
  onBackup: () => void;
  /** null قبل أن يُعرف الجواب. */
  persistence: Persistence | null;
  onPersist: () => void;
}) {
  const [part, setPart] = useState<"scoring" | "schools" | "me">("scoring");
  const [pwdOpen, setPwdOpen] = useState(false);
  const check = checkTotal(criteria);

  return (
    <section className="view">
      <div className="vhead">
        <div>
          <h2>الإعدادات</h2>
        </div>
      </div>

      <div className="segmented touch" role="group" aria-label="أبواب الإعدادات">
        <button aria-pressed={part === "scoring"} onClick={() => setPart("scoring")}>
          التقويم
        </button>
        <button aria-pressed={part === "schools"} onClick={() => setPart("schools")}>
          المؤسسات
        </button>
        <button aria-pressed={part === "me"} onClick={() => setPart("me")}>
          حسابي
        </button>
      </div>

      {part === "scoring" && (
      <>
      <div className="note" style={{ textWrap: "pretty" }}>
        المعايير والمركّبات تسري على كل الأقسام والفصول الثلاثة. وطريقة «بالسحب
        في الحصة» لمعيار واحد فقط.
      </div>

      <div className="card scoringcard">
        <div className="srow2">
          <div className="k">
            <b>معايير التقويم المستمر</b>
            <button className="helpq" onClick={() => onHelp(true)}>
              <InfoIcon />
              كيف تعمل معايير التقويم؟
            </button>
          </div>
          <span className={check.exact ? "pill ok" : "pill warn"}>
            المجموع {Number(check.total.toFixed(2))} / 20
          </span>
        </div>

        {check.warning && <div className="note warn">{check.warning}</div>}

        {criteria.map((c) => (
          <CriterionRow
            key={c.id}
            c={c}
            resetTick={resetTick}
            onCriterion={onCriterion}
            onDelete={onDeleteCriterion}
          />
        ))}

        <button className="btn soft full" onClick={onAddCriterion}>+ معيار</button>
      </div>

      <div className="card scoringcard">
        <div className="srow2">
          <b>مركّبات معدل المادة</b>
        </div>
        <div className="note">
          المركّبة المطفأة تخرج من القسمة تمامًا، وكذلك غير المنقَّطة.
        </div>

        {components.map((c) => {
          const fixed = c.code === "cc";
          return (
            <div key={c.id} className={c.active || fixed ? "crit" : "crit off"}>
              <div className="critop stackrow">
                {fixed ? (
                  <div className="k" style={{ flex: 1 }}>
                    {c.label}
                    <small>محصّلة المعايير أعلاه</small>
                  </div>
                ) : (
                  <input
                    className="cname"
                    id={`clabel-${c.code}`}
                    defaultValue={c.label}
                    aria-label="تسمية المركّبة"
                    onBlur={(e) => {
                      const text = e.target.value.trim();
                      if (text && text !== c.label) onComponent(c.id, { label: text });
                      else e.target.value = c.label;
                    }}
                  />
                )}
                <label className="cceil stack">
                  <span>المعامل</span>
                  <input
                    id={`weight-${c.code}`}
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    defaultValue={Number(c.weight)}
                    disabled={!c.active && !fixed}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value >= 0 && value <= 10) {
                        if (value !== Number(c.weight)) onComponent(c.id, { weight: value });
                      } else e.target.value = String(Number(c.weight));
                    }}
                  />
                </label>
                {!fixed && (
                  <button
                    className={c.active ? "sw on" : "sw"}
                    role="switch"
                    aria-checked={c.active}
                    aria-label={`${c.label}: ${c.active ? "مفعّلة" : "مطفأة"}`}
                    onClick={() => onComponent(c.id, { active: !c.active })}
                  >
                    <i />
                  </button>
                )}
              </div>
              {c.code === "tp" && c.active && (
                <div className="kinds" role="group" aria-label="تسمية سريعة">
                  {TP_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      aria-pressed={c.label === preset}
                      onClick={() => onComponent(c.id, { label: preset })}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}
              {!fixed && !c.active && (
                <small className="chint">مطفأة: لا تظهر للتلاميذ ولا تدخل المعدل.</small>
              )}
            </div>
          );
        })}
      </div>
      </>
      )}

      {part === "schools" && (
        <SchoolsSettings
          schools={schools}
          classes={classes}
          onAdd={onAddSchool}
          onRename={onRenameSchool}
          onDelete={onDeleteSchool}
        />
      )}

      {part === "me" && (
      <>
      {/* تُطبع في رأس كشف القسم، ولا تدخل أي حساب. والمؤسسة ليست منها:
          هي صفة القسم، فبابها «المؤسسات». */}
      <div className="card">
        <div className="srow2">
          <b>بياناتي</b>
          <div className="hspace" />
          <span className="pill">تظهر في الكشف المطبوع</span>
        </div>
        {([
          ["full_name", "الاسم واللقب", ""],
          ["subject", "المادة", "مثال: علوم الطبيعة والحياة"],
        ] as const).map(([field, label, hint]) => (
          <div key={field} className="srow2">
            <div className="k">
              {label}
              {hint && <small>{hint}</small>}
            </div>
            <input
              id={`profile-${field}`}
              style={{ width: 170 }}
              aria-label={label}
              defaultValue={profile[field] ?? ""}
              onBlur={(e) => {
                const text = e.target.value.trim();
                const next = field === "full_name" ? text : text === "" ? null : text;
                if (next !== (profile[field] ?? (field === "full_name" ? "" : null))) {
                  onProfile({ [field]: next } as Partial<Profile>);
                }
              }}
            />
          </div>
        ))}
      </div>

      {/* حفظ العمل: نسخة في يد الأستاذ، وحال الحفظ على هذا الجهاز */}
      <div className="card">
        <div className="srow2">
          <div className="k">
            نسختي
            <small>ملفٌّ فيه كل عملك تحتفظ به، وتستعيده لو ضاع حسابك</small>
          </div>
          <button className="btn soft" onClick={onBackup}>فتح</button>
        </div>
        <div className="srow2">
          <div className="k">
            الحفظ في هذا الجهاز
            <small>
              {persistence === "persisted"
                ? "دائم: لا يمسح المتصفّح ما لم يُرسل بعد"
                : persistence === "best-effort"
                  ? "عادي: قد يمسحه المتصفّح إن امتلأت ذاكرة الهاتف. تثبيت التطبيق على الشاشة الرئيسية يجعله دائمًا غالبًا"
                  : persistence === "unsupported"
                    ? "هذا المتصفّح لا يتيح الحفظ الدائم. التطبيق يعمل، فقط أرسل علاماتك ولا تؤجّل"
                    : "…"}
            </small>
          </div>
          {persistence === "best-effort" ? (
            <button className="btn ghost" onClick={onPersist}>اطلب</button>
          ) : (
            <span className={persistence === "persisted" ? "pill ok" : "pill"}>
              {persistence === "persisted" ? "دائم" : persistence === "unsupported" ? "غير متاح" : "…"}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="srow2">
          <div className="k">
            المظهر
            <small>فاتح أو داكن. يتبع هاتفك ما لم تغيّره</small>
          </div>
          <ThemeButton />
        </div>
        <div className="srow2">
          <div className="k">
            الحساب
            <small dir="ltr" style={{ textAlign: "start" }}>{email}</small>
          </div>
          <button className="btn ghost" onClick={onSignOut}>خروج</button>
        </div>
        <div className="srow2">
          <div className="k">
            كلمة السر
            <small>غيّرها وأنت داخل حسابك</small>
          </div>
          <button className="btn ghost" onClick={() => setPwdOpen(true)}>تغيير</button>
        </div>
        <div className="srow2">
          <div className="k">
            الخصوصية
            <small>أين تُحفظ بيانات تلاميذك ومن يراها</small>
          </div>
          <a className="btn ghost" href="/privacy">اقرأ</a>
        </div>
        <div className="srow2">
          <div className="k">
            شروط الاستخدام
            <small>ما يطلبه التطبيق منك وما يفعله</small>
          </div>
          <a className="btn ghost" href="/terms">اقرأ</a>
        </div>
        <div className="srow2">
          <div className="k">
            حذف الحساب
            <small>يمحو كل أقسامك وعلاماتك نهائيًا</small>
          </div>
          <a className="btn warn" href="/account">حذف…</a>
        </div>
      </div>
      </>
      )}
      {helpOpen && <CriteriaHelpSheet onClose={() => onHelp(false)} />}
      {pwdOpen && <ChangePasswordSheet email={email} onClose={() => setPwdOpen(false)} />}
    </section>
  );
}

const KINDS: CriterionKind[] = ["deduct", "add", "auto"];

/** رمز يميّز الطريقة بالنظر قبل القراءة: ناقص للخصم، زائد للإضافة، يد للسحب. */
function KindGlyph({ kind }: { kind: CriterionKind }) {
  return (
    <svg className="kglyph" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      {kind === "deduct" && <path d="M4 8h8" />}
      {kind === "add" && <path d="M4 8h8M8 4v8" />}
      {kind === "auto" && (
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
          <circle cx="6" cy="6" r="0.6" fill="currentColor" />
          <circle cx="10" cy="10" r="0.6" fill="currentColor" />
          <circle cx="10" cy="6" r="0.6" fill="currentColor" />
          <circle cx="6" cy="10" r="0.6" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="infoic" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 7.2v4M8 4.9v.1" />
    </svg>
  );
}

/**
 * بطاقة معيار: الاسم والعلامة القصوى والحذف في سطر، ثم الطريقة، ثم معنى
 * الخانة الفارغة في هذه الطريقة. المعنى ظاهر دائمًا لأنه ما يُساء فهمه؛
 * والمثال الرقمي يُفتح بلمسة على السطر نفسه فلا يطيل البطاقة.
 *
 * لا شيء هنا يغيّر الحفظ: الخانات والأزرار تنادي onCriterion كما كانت.
 */
function CriterionRow({
  c, resetTick, onCriterion, onDelete,
}: {
  c: Criterion;
  resetTick: number;
  onCriterion: (id: string, patch: Partial<Criterion>) => void;
  onDelete: (c: Criterion) => void;
}) {
  const [example, setExample] = useState(false);
  const [ceilingNotice, setCeilingNotice] = useState<CeilingNotice>(null);
  const ceilingCtl = useRef<CeilingController | null>(null);
  const [ceilingEdit, setCeilingEdit] = useState<CeilingEditState>({ focused: false, dirty: false });
  const explain = explainKind(c.kind, Number(c.ceiling));
  return (
    <div className="crit">
      <div className="critop stackrow">
        <input
          className="cname"
          id={`label-${c.code}`}
          defaultValue={c.label}
          aria-label="اسم المعيار"
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onBlur={(e) => {
            const text = e.target.value.trim();
            if (text && text !== c.label) onCriterion(c.id, { label: text });
            else e.target.value = c.label;
          }}
        />
        <CeilingField
          key={`${c.id}-${c.ceiling}-${resetTick}`}
          c={c}
          onCriterion={onCriterion}
          onNotice={setCeilingNotice}
          ctl={ceilingCtl}
          onState={setCeilingEdit}
        />
        <button
          className="icbtn danger"
          aria-label={`حذف معيار ${c.label}`}
          title="حذف المعيار"
          onClick={() => onDelete(c)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
          </svg>
        </button>
      </div>
      {(ceilingEdit.focused || ceilingEdit.dirty) && (
        <div className="cconfirm">
          <span role="status">
            {ceilingEdit.dirty
              ? "لم تُحفظ العلامة القصوى بعد: اضغط «تم» لحفظها."
              : "اكتب العلامة القصوى ثم اضغط «تم»."}
          </span>
          <button
            type="button"
            className="btn cdone"
            aria-label={`تم: حفظ العلامة القصوى لمعيار ${c.label}`}
            onClick={() => ceilingCtl.current?.confirm()}
          >
            تم
          </button>
        </div>
      )}
      {ceilingNotice && (
        <small className="cerr" role="alert">
          {`العلامة القصوى رقم أكبر من 0 وحتى\u00A0${CEILING_MAX}. لم تُحفظ، والقيمة الحالية\u00A0${Number(c.ceiling)}.`}
        </small>
      )}

      <div className="kinds kgrid" role="group" aria-label={`طريقة احتساب ${c.label}`}>
        {KINDS.map((kind) => (
          <button
            key={kind}
            title={kind === "auto" ? "لمعيار واحد فقط" : undefined}
            aria-pressed={c.kind === kind}
            onClick={() => onCriterion(c.id, { kind })}
          >
            <KindGlyph kind={kind} />
            <span>{kind === "deduct" ? `يبدأ كاملًا (${Number(c.ceiling)}) ويُخصم منه` : KIND_NAME[kind]}</span>
          </button>
        ))}
      </div>

      <button
        className="rule"
        aria-expanded={example}
        onClick={() => setExample((v) => !v)}
      >
        <InfoIcon />
        <span>
          {explain.short}
          {example && <small>{explain.example}</small>}
        </span>
        <i aria-hidden="true">{example ? "إخفاء" : "مثال"}</i>
      </button>
    </div>
  );
}

/** تنبيه الخانة: ما أُكِّد لا يصحّ فلم يُحفظ. */
type CeilingNotice = "invalid" | null;

/**
 * خانة العلامة القصوى. غير متحكَّم بها عمدًا: قواعد الحفظ والإلغاء وفقد التركيز
 * وإغلاق لوحة المفاتيح في src/lib/ceilingInput.ts وتُختبر هناك. الحفظ بـ«تم» أو Enter،
 * وزرّ «تم» في CriterionRow بجانب الخانة لا يعتمد على مفتاح في لوحة المفاتيح. المحفوظ يُقرأ من
 * `latest` عند كل تأكيد، والمفتاح (key) يعيد تركيب الخانة حين يتغيّر المحفوظ
 * أو يُرفض تغيير معلَّق فتعود إلى قيمتها.
 */
function CeilingField({
  c, onCriterion, onNotice, ctl, onState,
}: {
  c: Criterion;
  onCriterion: (id: string, patch: Partial<Criterion>) => void;
  onNotice: (notice: CeilingNotice) => void;
  /** يُسلَّم منها المتحكّم ليضغط زرّ «تم» (خارج الحقل) التأكيدَ نفسه. */
  ctl: { current: CeilingController | null };
  onState: (state: CeilingEditState) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef({ c, onCriterion, onNotice, onState });
  latest.current = { c, onCriterion, onNotice, onState };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const controller = attachCeilingInput(el, {
      getSaved: () => Number(latest.current.c.ceiling),
      onSave: (value) => {
        latest.current.onNotice(null);
        latest.current.onCriterion(latest.current.c.id, { ceiling: value });
      },
      onInvalid: () => latest.current.onNotice("invalid"),
      onEdit: () => latest.current.onNotice(null),
      onState: (state) => latest.current.onState(state),
    });
    ctl.current = controller;
    return () => {
      controller.detach();
      if (ctl.current === controller) ctl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <label className="cceil stack">
      <span>العلامة القصوى</span>
      <input
        ref={ref}
        id={`ceiling-${c.code}`}
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        dir="ltr"
        aria-label={`العلامة القصوى لمعيار ${c.label}`}
        defaultValue={showCeiling(Number(c.ceiling))}
      />
    </label>
  );
}

/**
 * «كيف تعمل معايير التقويم؟»: ورقة قصيرة تُفتح عند الطلب ولا تظهر وحدها.
 * الأمثلة من criteriaHelp.ts، فتُحسب بدوال الحساب نفسها.
 */
function CriteriaHelpSheet({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeNow = useRef(onClose);
  closeNow.current = onClose;
  useEffect(() => {
    // التركيز على زرّ الإغلاق: لوحة المفاتيح الخارجية تغلقها Escape، ومن يستعمل
    // قارئ الشاشة يبدأ من داخل النافذة لا من خلفها.
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNow.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet helpsheet" role="dialog" aria-modal="true" aria-labelledby="crit-help-title">
        <div className="shead">
          <h3 id="crit-help-title">كيف تعمل معايير التقويم؟</h3>
          <button ref={closeRef} className="icbtn" aria-label="إغلاق" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <ol className="helpsteps">
          <li>
            <b>أضف معيارًا</b>
            <p>اضغط «+ معيار» أسفل القائمة، ثم اكتب اسمه مكان «معيار جديد».</p>
          </li>
          <li>
            <b>حدّد علامته القصوى</b>
            <p>
              أعلى ما يناله التلميذ فيه، مثل: الانضباط من 4. يُستحسن أن يكون مجموع
              المعايير 20؛ وإن اختلف حوّل التطبيق النقطة إلى 20 وحده.
            </p>
          </li>
          <li>
            <b>اختر طريقة الاحتساب</b>
            {KINDS.map((kind) => (
              <div key={kind} className="helpkind">
                <span className="hk"><KindGlyph kind={kind} />{KIND_NAME[kind]}</span>
                <p>{explainKind(kind, 4).rule}</p>
                <small>{explainKind(kind, 4).example}</small>
              </div>
            ))}
          </li>
          <li>
            <b>الخانة الفارغة ليست صفرًا</b>
            <p>
              في معيار الخصم تعني العلامة الكاملة، وفي غيره تعني «لم يُقيَّم بعد»
              فتخرج من الحساب. هكذا لا يظهر التلميذ في منتصف الفصل أضعف مما هو.
            </p>
            <small>{WALKTHROUGH.lead} <span className="nobreak"><bdi dir="ltr">{WALKTHROUGH.expr}</bdi> من 20.</span></small>
          </li>
        </ol>
        <button className="btn full helpdone" onClick={onClose}>فهمت</button>
      </div>
    </>
  );
}

/**
 * المؤسسات وأقسامها.
 *
 * حذف المؤسسة لا يحذف أقسامها — تبقى بلا مؤسسة وتُنسب من جديد — فالتأكيد
 * سطرٌ في مكانه لا ورقة منبثقة: لا علامة تضيع.
 */
function SchoolsSettings({
  schools, classes, onAdd, onRename, onDelete,
}: {
  schools: School[];
  /** للعدّ وحده: مؤسسة القسم تُختار مرة عند استيراده. */
  classes: Klass[];
  onAdd: (name: string) => Promise<School | null>;
  onRename: (id: string, name: string) => void;
  onDelete: (school: School) => void;
}) {
  const [adding, setAdding] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);

  return (
    <>
      <div className="note">
        المؤسسة صفة القسم: رأس كشفه يأخذ اسمها، والأقسام تُجمع بها في
        قائمة الأقسام.
      </div>

      <div className="card">
        <div className="srow2">
          <b>مؤسساتي</b>
          <div className="hspace" />
          <span className="pill">{schools.length}</span>
        </div>

        {schools.length === 0 && (
          <div className="srow2">
            <div className="k">
              لا مؤسسة بعد
              <small>أضف ثانويتك ليظهر اسمها في الكشف المطبوع</small>
            </div>
          </div>
        )}

        {schools.map((school) => {
          const count = classes.filter((c) => c.school_id === school.id).length;
          return (
            <div key={school.id} className="crit">
              <div className="critop">
                <input
                  className="cname"
                  id={`school-${school.id}`}
                  aria-label="اسم المؤسسة"
                  defaultValue={school.name}
                  onBlur={(e) => {
                    const text = e.target.value.trim();
                    if (text && text !== school.name) onRename(school.id, text);
                    else e.target.value = school.name;
                  }}
                />
                <span className="pill">
                  {countWord(count, "قسم واحد", "قسمان", "أقسام", "قسمًا")}
                </span>
                <button
                  className="icbtn danger"
                  aria-label={`حذف ${school.name}`}
                  onClick={() => setConfirm(confirm === school.id ? null : school.id)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                  </svg>
                </button>
              </div>
              {confirm === school.id && (
                <div className="srow2">
                  <div className="k">
                    {count
                      ? `لا تضيع علامة، لكن ${countWord(count, "قسمًا واحدًا سيُسأل", "قسمين سيُسألان", "أقسام ستُسأل", "قسمًا سيُسأل")} عن مؤسسة جديدة.`
                      : "لا أقسام فيها."}
                  </div>
                  <button className="btn ghost" onClick={() => setConfirm(null)}>تراجع</button>
                  <button
                    className="btn warn"
                    onClick={() => {
                      setConfirm(null);
                      onDelete(school);
                    }}
                  >
                    احذفها
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="srow2 addrow">
          <input
            id="school-new"
            value={adding}
            aria-label="مؤسسة جديدة"
            placeholder="أضف مؤسسة: ثانوية…"
            onChange={(e) => setAdding(e.target.value)}
          />
          <button
            className="btn soft"
            disabled={!adding.trim()}
            onClick={async () => {
              const created = await onAdd(adding.trim());
              if (created) setAdding("");
            }}
          >
            أضف
          </button>
        </div>
      </div>

    </>
  );
}
