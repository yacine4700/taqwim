/* شكل الطلب الذي يرسله @supabase/supabase-js لنقل الأسماء: «تجاهُل التعارض» لا «تحديثه».
   بلا شبكة: fetch وهمي يلتقط الطلب. يحتاج node_modules، فمحليًّا بلا تثبيت يُعلن التخطّي صراحةً،
   وفي CI (متغيّر CI) غيابه فشل لا تخطٍّ. */
let createClient;
try {
  ({ createClient } = await import("@supabase/supabase-js"));
} catch {
  if (process.env.CI) { console.error("FAIL @supabase/supabase-js غير متاح في CI"); process.exit(1); }
  console.log("SKIPPED check-move-request: @supabase/supabase-js غير مثبّت هنا (يُشغَّل في CI فقط)");
  process.exit(0);
}

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
}

const seen = [];
const fakeFetch = async (url, init = {}) => {
  const h = new Headers(init.headers);
  seen.push({ url: String(url), method: init.method, prefer: h.get("prefer"), body: init.body ? JSON.parse(init.body) : null });
  return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
};
const sb = createClient("https://example.supabase.co", "public-anon-key", { global: { fetch: fakeFetch }, auth: { persistSession: false, autoRefreshToken: false } });

console.log("— قسم: upsert بتجاهل التعارض");
await sb.from("classes").upsert({ id: "c1", teacher_id: "T", name: "x", position: 1, school_id: "s" }, { onConflict: "id", ignoreDuplicates: true });
let r = seen.at(-1);
t("POST إلى classes", [r.method, new URL(r.url).pathname], ["POST", "/rest/v1/classes"]);
t("on_conflict=id", new URL(r.url).searchParams.get("on_conflict"), "id");
t("Prefer يحمل ignore-duplicates", /resolution=ignore-duplicates/.test(r.prefer ?? ""), true);
t("Prefer لا يحمل merge-duplicates (لا DO UPDATE)", /merge-duplicates/.test(r.prefer ?? ""), false);

console.log("— تلاميذ: دفعة واحدة بتجاهل التعارض");
const rows = [1, 2, 3].map((i) => ({ id: `s${i}`, teacher_id: "T", class_id: "c1", full_name: `n${i}`, position: i }));
await sb.from("students").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
r = seen.at(-1);
t("POST إلى students بثلاثة صفوف في طلب واحد", [new URL(r.url).pathname, r.body.length], ["/rest/v1/students", 3]);
t("ignore-duplicates ولا merge", [/resolution=ignore-duplicates/.test(r.prefer ?? ""), /merge-duplicates/.test(r.prefer ?? "")], [true, false]);
t("on_conflict=id", new URL(r.url).searchParams.get("on_conflict"), "id");

console.log("— التحقق بالقراءة");
await sb.from("classes").select("id").eq("id", "c1");
r = seen.at(-1);
t("GET classes?id=eq.c1", [r.method, new URL(r.url).searchParams.get("id")], ["GET", "eq.c1"]);
await sb.from("students").select("id").in("id", ["a", "b"]);
r = seen.at(-1);
t("GET students?id=in.(a,b)", [r.method, new URL(r.url).searchParams.get("id")], ["GET", "in.(a,b)"]);

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
