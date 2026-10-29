import type { Metadata } from "next";

/** لا يُفهرَس شيء تحت /admin، ولا يخرج اسمه في أي روابط عامة. */
export const metadata: Metadata = {
  title: "الإشراف — دفتر التقويم المستمر",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
