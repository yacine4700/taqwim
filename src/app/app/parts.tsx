"use client";

import { useEffect } from "react";
import { Student, Tab } from "./types";

/** سطر الحالة الخاصة كما يظهر تحت الاسم: الحالات الجاهزة ثم الملاحظة الحرة. */
export function state(student: Student): string {
  return [...(student.tags ?? []), student.note ?? ""]
    .filter((part) => part.trim() !== "")
    .join(" · ");
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

export function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="kpi">
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

const TAB_ITEMS: Array<{ key: Tab; label: string; path: string }> = [
  { key: "classes", label: "الأقسام", path: "M4 6h16M4 12h16M4 18h10" },
  { key: "session", label: "الحصة", path: "M12 4v16M4 12h16" },
  { key: "stats", label: "الإحصاء", path: "M5 19V10M12 19V5M19 19v-6" },
  { key: "docs", label: "الوثائق", path: "M7 3h7l4 4v14H7zM14 3v4h4M10 13h6M10 17h6" },
  { key: "settings", label: "الإعدادات", path: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2M18 12h2M12 4v2M12 18v2" },
];

export function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="tabs" role="tablist">
      <div className="inner">
        {TAB_ITEMS.map((item) => (
          <button key={item.key} aria-pressed={tab === item.key} onClick={() => onChange(item.key)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d={item.path} />
            </svg>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function ThemeButton() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved) document.documentElement.setAttribute("data-theme", saved);
    } catch {
      /* private window */
    }
  }, []);

  return (
    <button
      className="icbtn"
      aria-label="تغيير المظهر"
      onClick={() => {
        const current = document.documentElement.getAttribute("data-theme");
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const next = current ? (current === "dark" ? "light" : "dark") : prefersDark ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem("theme", next);
        } catch {
          /* private window */
        }
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
      </svg>
    </button>
  );
}
