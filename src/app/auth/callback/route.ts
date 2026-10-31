import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { callbackTarget, safeNext } from "@/lib/auth";
import { isBannedError } from "@/lib/account";

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
  let outcome: "ok" | "banned" | "failed" = "failed";

  // قد يردّ Supabase إلى هنا بنفسه والخطأ في العنوان قبل أي رمز
  if (searchParams.get("error_code") === "user_banned") {
    outcome = "banned";
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    outcome = !error ? "ok" : isBannedError(error) ? "banned" : "failed";
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    outcome = !error ? "ok" : isBannedError(error) ? "banned" : "failed";
  }

  return NextResponse.redirect(new URL(callbackTarget(outcome, next), request.url));
}
