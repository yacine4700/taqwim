import { type Group } from "@/lib/groups";
import { type TermRow } from "@/lib/terms";
import {
  type Component,
  type Criterion,
  type Reading,
  type RecordRow,
  type TpMark,
  type TpSession,
  type TpTarget,
} from "@/lib/scoring";

export type Klass = {
  id: string;
  name: string;
  position: number;
  /** المؤسسة التي يُدرَّس فيها القسم، أو null لقسم لم يُنسب بعد. */
  school_id: string | null;
  /** أين يذهب معدّل حصص الأعمال التطبيقية: null لا ربط، أو 'component'، أو 'criterion:<code>'. */
  tp_target: TpTarget;
};

export type School = { id: string; name: string; position: number };

export type Student = {
  id: string;
  class_id: string;
  full_name: string;
  position: number;
  /** حالات جاهزة تُختار بنقرة. لا تدخل أي حساب. */
  tags: string[];
  /** ملاحظة حرة لما لا تغطّيه الحالات الجاهزة. لا تدخل أي حساب. */
  note: string | null;
  /** فوجه في القسم، أو null إن لم يُوزَّع. لا يدخل أي حساب. */
  group_id: string | null;
};

/**
 * الحالات الجاهزة: صيغت بما يفيد الأستاذ في الحصة (ما يفعله)، لا بتوصيف
 * التلميذ. فـ«يحتاج مقدّمة القسم» إجراء عملي يغطّي أسبابًا كثيرة دون أن
 * يُسجّل عن التلميذ ما ليس من شأن دفتر التنقيط.
 */
export const STATE_TAGS = [
  "غياب متكرر",
  "يحتاج مقدّمة القسم",
  "لا يملك الكتاب",
  "متابعة من الولي",
  "قليل المشاركة",
  "يحتاج تشجيعًا",
];

export type Tab = "classes" | "stats" | "docs" | "settings";

/**
 * بيانات الأستاذ كما تُطبع في رأس الكشف.
 * المؤسسة ليست منها: هي صفة القسم، فالأستاذ الواحد يدرّس في ثانويتين.
 */
export type Profile = { full_name: string; subject: string | null };

export const NO_PROFILE: Profile = { full_name: "", subject: null };

/** نسخة الخادم كما حُفظت في الجهاز، لتفتح الشاشة بلا شبكة. */
export type Snapshot = {
  classes: Klass[];
  schools: School[];
  profile: Profile;
  students: Student[];
  criteria: Criterion[];
  components: Component[];
  records: RecordRow[];
  readings: Reading[];
  /** الأفواج وحصص الأعمال التطبيقية: غائبة من نسخة أقدم من هذا الإصدار. */
  groups?: Group[];
  sessions?: TpSession[];
  tpMarks?: TpMark[];
  tpReady?: boolean;
  /** روزنامة الفصول: غائبة من نسخة أقدم من هذا الإصدار، فلا يُقفل شيء حتى تصل. */
  calendar?: TermRow[];
  savedAt: number;
};
