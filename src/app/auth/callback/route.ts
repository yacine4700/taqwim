import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth";

/**
 * ما بعد النقر على الرابط في البريد (استعادة كلمة السر، وتأكيد العنوان).
 * يقبل صيغتين: code (PKCE، يعمل في المتصفح الذي طُلب منه الرابط)، و
 * token_hash + type (يعمل من أي جهاز، ويلزمه قالب بريد يرسله — انظر
 * supabase/README.md). ما فشل يعود إلى /login مع علامة ليشرح لها الصفحة.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();
  let failed = true;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = !!error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failed = !!error;
  }

  const target = failed ? "/login?error=link" : next;
  return NextResponse.redirect(new URL(target, request.url));
}
