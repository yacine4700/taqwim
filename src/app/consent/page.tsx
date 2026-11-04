import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { needsConsent } from "@/lib/auth";
import ConsentClient from "./ConsentClient";

/**
 * شاشة الموافقة لحساب قائم على نسخة أقدم من الموافقة (أو بلا نسخة): تحوّل إليها /app.
 * بلا جلسة يعود صاحبها إلى /login، ومن وافق على النسخة الحالية يعود إلى /app.
 * تحويل (لا عرض داخل /app) كي لا يُخبَّأ هذا المحتوى مكان هيكل /app في عامل الخدمة.
 */
export default async function ConsentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!needsConsent(user.user_metadata)) redirect("/app");
  return <ConsentClient email={user.email ?? ""} />;
}
