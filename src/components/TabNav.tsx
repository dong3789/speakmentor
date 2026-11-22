"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; d: string }[] = [
  { href: "/", label: "대화", d: "M4 5h16v11H9l-5 4V5z" },
  { href: "/review", label: "복습", d: "M7 4h10v16l-5-3-5 3V4z" },
  { href: "/stats", label: "통계", d: "M5 20V10M12 20V4M19 20v-7" },
  { href: "/diary", label: "일기", d: "M12 21c-4-3-7-5-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4-3 6-7 9z" },
  { href: "/podcast", label: "팟캐스트", d: "M4 14v-3a8 8 0 0 1 16 0v3M4 14h3v7H4zM17 14h3v7h-3z" },
  { href: "/history", label: "기록", d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3" },
];

/** Shared bottom tab bar. Diary is hidden in demo mode on every page. */
export default function TabNav() {
  const pathname = usePathname() || "/";
  const [hideDiary, setHideDiary] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/auth/me")
        .then(async (r) => {
          if (cancelled) return;
          if (!r.ok) { setHideDiary(false); return; }
          const d = await r.json().catch(() => ({}));
          setHideDiary(Boolean(d.is_demo));
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("sm-auth-changed", load);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("sm-auth-changed", load);
      window.removeEventListener("focus", load);
    };
  }, []);

  const items = hideDiary ? ITEMS.filter((i) => i.href !== "/diary") : ITEMS;

  function isOn(href: string) {
    if (href === "/") return pathname === "/" || pathname === "/live";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="nav">
      {items.map((i) => (
        <a key={i.href} href={i.href} className={isOn(i.href) ? "on" : undefined}>
          <svg viewBox="0 0 24 24"><path d={i.d} /></svg>
          <span>{i.label}</span>
        </a>
      ))}
    </nav>
  );
}
