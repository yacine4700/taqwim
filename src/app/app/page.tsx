import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppClient from "./AppClient";

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // المعرّف يصل مع الصفحة لا بنداء على الخادم عند كل كتابة: في القاعة بلا
  // شبكة لا يُجاب ذلك النداء، فتتعطّل كتابة كانت ستنجح من الطابور.
  return <AppClient email={user.email ?? ""} teacherId={user.id} />;
}
