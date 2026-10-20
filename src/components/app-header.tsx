"use client";

// import { Monitor, Moon, Sun } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
// import { useEffect, useState } from "react";

// type ThemeMode = "system" | "light" | "dark";

export function AppHeader({ compact = false, userName, onChangeName }: { compact?: boolean; userName?: string; onChangeName?: () => void }) {
  // Theme toggle — commented out by request
  // const [theme, setTheme] = useState<ThemeMode>("system");

  // useEffect(() => {
  //   const saved = localStorage.getItem("campusprints:theme") as ThemeMode | null;
  //   if (saved === "light" || saved === "dark" || saved === "system") {
  //     setTheme(saved);
  //     if (saved === "system") document.documentElement.removeAttribute("data-theme");
  //     else document.documentElement.dataset.theme = saved;
  //   }
  // }, []);

  // function cycleTheme() {
  //   const next: ThemeMode = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  //   setTheme(next);
  //   if (next === "system") document.documentElement.removeAttribute("data-theme");
  //   else document.documentElement.dataset.theme = next;
  //   localStorage.setItem("campusprints:theme", next);
  // }

  // const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <header className={`app-header ${compact ? "compact" : ""}`}>
      <div className="header-pill">
        <Link className="brand-link" href="/" aria-label="Campus Prints home">
          <Image className="brand-logo" src="/icononly.jpg" alt="" width={36} height={36} priority />
          <span>
            <span className="brand-name">Campus Prints</span>
            <span className="brand-tagline">Smart students print with us.</span>
          </span>
        </Link>
        <div className="header-actions">
          {!compact && onChangeName && (
            <button className="header-link" type="button" onClick={onChangeName}>
              Not {userName}?
            </button>
          )}
          {/* Admin link removed for student view by request */}
          {/* {!compact && <Link className="header-link" href="/admin">Admin</Link>} */}
          {/* Theme toggle commented out by request */}
          {/* <button
            className="theme-button"
            type="button"
            onClick={cycleTheme}
            aria-label={`Theme: ${theme}. Change theme`}
            title={`Theme: ${theme}`}
          >
            <ThemeIcon size={16} aria-hidden="true" />
          </button> */}
        </div>
      </div>
    </header>
  );
}
