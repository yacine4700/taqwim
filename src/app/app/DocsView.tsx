"use client";

import { useState } from "react";
import { groupBySchool } from "@/lib/schools";
import { Klass, Profile, School } from "./types";

/**
 * الوثائق: كل ما له ملف في مكان واحد.
 *
 * كانت وثيقة حجز النقاط في الإعدادات والكشف مخبّأً في أسفل جدول القسم، وهذا
 * خلط بين ما يُضبط مرة في السنة وما يُستعمل كل فصل. والأستاذ يبحث عن «وثيقة»
 * لا عن «إعداد».
 *
 * والفرق بين الاثنتين مكتوب هنا لا في الذاكرة: الإكسل يُرسل إلى الإدارة
 * بأربع خانات، والكشف يبقى عند الأستاذ بكل التفصيل.
 */
export function DocsView({
  classes, schools, profile, onImport, onExport, onPrint,
}: {
  classes: Klass[];
  schools: School[];
  profile: Profile;
  onImport: () => void;
  onExport: () => void;
  onPrint: (classId: string) => void;
}) {
  const [forPrint, setForPrint] = useState("");
  const chosen = forPrint || classes[0]?.id || "";
  // اسم الأستاذ وحده هو الناقص هنا: مؤسسة الكشف صارت من القسم.
  const missingSchool = classes.some((c) => !c.school_id);
  const groups = groupBySchool(classes, schools);

  return (
    <section className="view">
      <div className="vhead">
        <div>
          <h2>الوثائق</h2>
          <p>ما يدخل التطبيق من ملفات وما يخرج منه.</p>
        </div>
      </div>

      <div className="card doccard">
        <div className="dochead">
          <b>وثيقة حجز النقاط</b>
          <span className="pill">إلى الإدارة</span>
        </div>
        <p>
          ارفع الوثيقة التي نزّلتها، فتُملأ خانات أقسامك كلها دفعة واحدة —
          التقويم المستمر والأعمال التطبيقية ومعدل الفروض والاختبار — وتعود
          برؤوسها وتنسيقها كما كانت.
        </p>
        <button className="btn full" onClick={onExport} disabled={!classes.length}>
          ارفع الوثيقة واملأها
        </button>
      </div>

      <div className="card doccard">
        <div className="dochead">
          <b>كشف القسم</b>
          <span className="pill">يبقى عندك</span>
        </div>
        <p>
          ورقة A4 فيها القسم كله: كل معيار في عموده، والمعدل والرتبة والتقدير،
          وإحصاء القسم وسطر الإمضاءين. تطبعها أو تحفظها PDF — للمداولات، أو
          لتبيّن من أين جاءت النقطة.
        </p>
        {!classes.length ? (
          <div className="note">استورد قسمًا أولًا.</div>
        ) : (
          <>
            {!profile.full_name && (
              <div className="note warn">
                اكتب اسمك في الإعدادات ← حسابي ليظهر في رأس الكشف.
              </div>
            )}
            {missingSchool && (
              <div className="note warn">
                بعض أقسامك بلا مؤسسة، فيُطبع رأس كشفها بلا اسم ثانوية.
              </div>
            )}
            <div className="pickbar">
              <select
                value={chosen}
                aria-label="القسم"
                onChange={(e) => setForPrint(e.target.value)}
                style={{ flex: 1 }}
              >
                {/* الأقسام مجموعة بمؤسساتها: اسم القسم وحده يتشابه بين ثانويتين */}
                {groups.map((group) =>
                  groups.length > 1 ? (
                    <optgroup key={group.key} label={group.name}>
                      {group.classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  ) : (
                    group.classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))
                  ),
                )}
              </select>
              <button className="btn" onClick={() => onPrint(chosen)}>
                افتح الكشف
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card doccard">
        <div className="dochead">
          <b>استيراد قسم</b>
          <span className="pill">إلى التطبيق</span>
        </div>
        <p>
          من ملف الإشراف التربوي (xlsx) يُقرأ اسم القسم وأسماء تلاميذه، أو
          الصق الأسماء سطرًا لكل تلميذ.
        </p>
        <button className="btn soft full" onClick={onImport}>استيراد قائمة</button>
      </div>
    </section>
  );
}
