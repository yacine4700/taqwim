import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // الإشراف له صفحة دخول خاصة به؛ ولا يُحوَّل صاحب جلسة قائمة عنها (قد يحتاج إعادة الرمز).
  const adminArea = path === "/admin" || path.startsWith("/admin/");
  if (!user && adminArea && path !== "/admin/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (!user && ["/app", "/account"].some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }
  return response;
}

/**
 * عامل الخدمة والـmanifest خارج المرشّح: لو مرّا بالوسيط لصار لكل طلب منهما
 * نداء تحقّق من الجلسة، وهما يُطلبان قبل الدخول أصلًا — عند تثبيت التطبيق.
 *
 * وكذلك /.well-known/ (assetlinks.json لتطبيق Android): تقرؤه خدمة Google بلا جلسة،
 * ولا يُقبل فيه تحويل. الوسيط هو الموضع الوحيد الذي قد يحوّل طلبًا أو يضيف إليه
 * كوكيز، فيبقى الملف خارجه ملفًّا ثابتًا لا يتعلّق بـ Supabase ولا بتعديل لاحق للوسيط.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
