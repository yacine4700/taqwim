"use client";

import { useState } from "react";
import { countWord } from "@/lib/outbox";
import { checkTotal, type Component, type Criterion } from "@/lib/scoring";
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
  onCriterion, resetTick, onAddCriterion, onDeleteCriterion, onComponent, onProfile,
  onAddSchool, onRenameSchool, onDeleteSchool, onSignOut,
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
  onAddCriterion: () => void;
  onDeleteCriterion: (c: Criterion) => void;
  onComponent: (id: string, patch: Partial<Component>) => void;
  onProfile: (patch: Partial<Profile>) => void;
  onAddSchool: (name: string) => Promise<School | null>;
  onRenameSchool: (id: string, name: string) => void;
  onDeleteSchool: (school: School) => void;
  onSignOut: () => void;
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

      <div className="segmented" role="group" aria-label="أبواب الإعدادات">
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
      <div className="note">
        المعايير والمركّبات تسري على كل الأقسام والفصول الثلاثة.
      </div>

      <div className="card">
        <div className="srow2">
          <b>معايير التقويم المستمر</b>
          <div className="hspace" />
          <span className={check.exact ? "pill ok" : "pill warn"}>
            المجموع {Number(check.total.toFixed(2))} / 20
          </span>
        </div>

        {check.warning && <div className="note warn">{check.warning}</div>}

        {criteria.map((c) => (
          <div key={c.id} className="crit">
            <div className="critop">
              <input
                className="cname"
                id={`label-${c.code}`}
                defaultValue={c.label}
                aria-label="تسمية المعيار"
                onBlur={(e) => {
                  const text = e.target.value.trim();
                  if (text && text !== c.label) onCriterion(c.id, { label: text });
                  else e.target.value = c.label;
                }}
              />
              <label className="cceil">
                <span>السقف</span>
                <input
                  key={`${c.id}-${c.ceiling}-${resetTick}`}
                  id={`ceiling-${c.code}`}
                  type="number"
                  min={0.5}
                  max={20}
                  step={0.5}
                  defaultValue={Number(c.ceiling)}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (value > 0 && value <= 20) {
                      if (value !== Number(c.ceiling)) onCriterion(c.id, { ceiling: value });
                    } else e.target.value = String(Number(c.ceiling));
                  }}
                />
              </label>
              <button
                className="icbtn danger"
                aria-label={`حذف ${c.label}`}
                onClick={() => onDeleteCriterion(c)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                </svg>
              </button>
            </div>

            <div className="kinds" role="group" aria-label="نقطة الانطلاق">
              <button
                aria-pressed={c.kind === "deduct"}
                onClick={() => onCriterion(c.id, { kind: "deduct" })}
              >
                يبدأ كاملًا ({Number(c.ceiling)}) ويُخصم منه
              </button>
              <button
                aria-pressed={c.kind === "add"}
                onClick={() => onCriterion(c.id, { kind: "add" })}
              >
                يبدأ من 0 ويُضاف إليه
              </button>
              <button
                aria-pressed={c.kind === "auto"}
                onClick={() => onCriterion(c.id, { kind: "auto" })}
              >
                من محاولات القراءة
              </button>
            </div>
            <small className="chint">
              {c.kind === "deduct"
                ? "يُحسب لكل تلميذ دائمًا: الخانة الفارغة تعني العلامة الكاملة."
                : c.kind === "auto"
                  ? "نقطة محسوبة من متوسط محاولات القراءة، لا تُدخلها بيدك."
                  : "لا يُحسب حتى تُنقّطه: الخانة الفارغة تخرج من القسمة ولا تُحسب صفرًا."}
            </small>
          </div>
        ))}

        <button className="btn soft full" onClick={onAddCriterion}>+ معيار</button>
      </div>

      <div className="card">
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
              <div className="critop">
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
                <label className="cceil">
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
            حذف الحساب
            <small>يمحو كل أقسامك وعلاماتك نهائيًا</small>
          </div>
          <a className="btn warn" href="/account">حذف…</a>
        </div>
      </div>
      </>
      )}
      {pwdOpen && <ChangePasswordSheet email={email} onClose={() => setPwdOpen(false)} />}
    </section>
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
