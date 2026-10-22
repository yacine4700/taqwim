import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { pendingPurge } from "@/lib/account";
import AppClient from "./AppClient";
import DeletionPending from "./DeletionPending";

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // خلال مهلة الحذف تظهر شاشة المهلة وحدها. إن تعذّر السؤال (الدالة غير موجودة
  // قبل الترحيل، أو عطل) يُفتح التطبيق كالمعتاد: القاعدة نفسها تمنع الكتابة.
  const { data: status } = await supabase.rpc("my_account_status");
  const purgeAfter = pendingPurge(status);
  if (purgeAfter) {
    return <DeletionPending purgeAfter={purgeAfter} email={user.email ?? ""} teacherId={user.id} />;
  }

  // المعرّف يصل مع الصفحة لا بنداء على الخادم عند كل كتابة: في القاعة بلا
  // شبكة لا يُجاب ذلك النداء، فتتعطّل كتابة كانت ستنجح من الطابور.
  return <AppClient email={user.email ?? ""} teacherId={user.id} />;
}
