

/** تاريخ اليوم بتوقيت الجهاز. ISO يعطي توقيت غرينتش، فيقدّم المحاولة يومًا قبل الفجر. */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
