/**
 * «نسختي» على Supabase: قراءة حساب الأستاذ كاملًا والكتابة فيه.
 *
 * القراءة على صفحات: الخادم يُرجع 1000 صفّ على الأكثر في الطلب الواحد،
 * وملفٌّ يقف عند الألف بلا تنبيه نسخةٌ ناقصة تبدو كاملة. والترتيب ثابت
 * (بالمفتاح) كي لا يتكرّر صفّ بين صفحتين أو يسقط.
 *
 * كل طلب يمرّ بجلسة الأستاذ: RLS تقصر القراءة والكتابة على صفوفه وحده.
 */

import type { createClient } from "@/lib/supabase/client";
import {
  buildBackup,
  COLUMNS,
  readAccount,
  type Backup,
  type Db,
  type Table,
} from "@/lib/backup";
import type { Op } from "@/lib/outbox";

type Supabase = ReturnType<typeof createClient>;

const PAGE = 1000;

const ORDER: Record<Table, string[]> = {
  schools: ["id"],
  classes: ["id"],
  class_groups: ["id"],
  students: ["id"],
  criteria: ["id"],
  components: ["id"],
  records: ["student_id", "term"],
  readings: ["id"],
  tp_sessions: ["id"],
  tp_marks: ["session_id", "student_id"],
  teachers: ["id"],
};

export function supabaseDb(supabase: Supabase): Db {
  return {
    async selectAll(table) {
      const out: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        let query = supabase.from(table).select(COLUMNS[table]);
        for (const column of ORDER[table]) query = query.order(column);
        const { data, error } = await query.range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as unknown as Record<string, unknown>[];
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    },
    async insert(table, rows) {
      if (!rows.length) return;
      const { error } = await supabase.from(table).insert(rows);
      if (error) throw new Error(error.message);
    },
    async upsert(table, rows, onConflict) {
      if (!rows.length) return;
      const { error } = await supabase.from(table).upsert(rows, { onConflict });
      if (error) throw new Error(error.message);
    },
    async update(table, match, patch) {
      let query = supabase.from(table).update(patch);
      for (const [column, value] of Object.entries(match)) query = query.eq(column, value);
      // صفر صفوف تحت RLS ليس خطأً في Postgres، لكنه هنا فشل: لم يُعدَّل شيء
      const { data, error } = await query.select("*");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error("لم يُعدَّل شيء في الخادم");
    },
  };
}

/** نسخة كاملة من الخادم، مع ما في طابور الجهاز منفصلًا. */
export async function exportFromServer(
  supabase: Supabase,
  teacher: { id: string; email: string },
  pending: Op[],
): Promise<Backup> {
  const account = await readAccount(supabaseDb(supabase));
  return buildBackup({
    source: "server",
    teacher: { ...teacher, ...account.profile },
    data: account.data,
    pending,
  });
}
