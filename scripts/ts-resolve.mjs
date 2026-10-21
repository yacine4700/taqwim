/* يُحمَّل بـ --import قبل الاختبارات التي تستورد الشفرة الحقيقية (src/lib/*.ts).
   الشفرة تستورد بعضها بلا امتداد ("./scoring") كما يريد Next، وNode لا يُكمل
   الامتداد وحده؛ هذا الخطّاف يجرّب ".ts" حين يفشل المسار كما هو. لا شيء غيره. */
import { register } from "node:module";

register("./ts-resolve-hooks.mjs", import.meta.url);
