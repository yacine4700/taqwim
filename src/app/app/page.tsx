import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppClient from "./AppClient";

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <AppClient email={user.email ?? ""} />;
}
