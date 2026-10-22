import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminClient from "./AdminClient";

export const metadata = { title: "الإشراف — دفتر التقويم المستمر", robots: { index: false } };

/**
 * صفحة المشرف. لا رابط إليها من التطبيق. وجودها لا يمنح شيئًا: كل ما فيها
 * دوال في القاعدة ترفض من ليس في private.admins أو من لم يُدخل رمز التحقّق
 * الثنائي في هذه الجلسة (aal2).
 */
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <AdminClient email={user.email ?? ""} />;
}
