import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { parseAdminState } from "@/lib/admin";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

/**
 * بوابة الخادم. يُقرَّر هنا قبل أن تُرسَل أي واجهة إلى المتصفّح:
 *   - بلا جلسة ⇒ صفحة دخول المشرف.
 *   - حساب ليس في private.admins ⇒ 404 كأن الصفحة غير موجودة.
 *   - مشرف تحقّقه الثنائي منتهٍ أو غائب ⇒ صفحة الدخول لإعادة الرمز.
 * والقرار يأتي من am_i_admin في القاعدة (جلسة المتصل وجداول الخادم)، لا من شيء يرسله
 * العميل. ومع ذلك فهذه البوابة راحة لا حماية: كل دالة إدارية تعيد التحقّق بنفسها.
 */
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data, error } = await supabase.rpc("am_i_admin");
  // الدالة غير موجودة (الترحيل لم يُطبَّق) أو عطل: كأن الصفحة غير موجودة.
  if (error) notFound();
  const state = parseAdminState(data);
  if (!state.listed) notFound();
  if (!state.ready) redirect("/admin/login?reauth=1");

  return <AdminClient email={user.email ?? ""} initialExpiresAt={state.mfaExpiresAt} />;
}
