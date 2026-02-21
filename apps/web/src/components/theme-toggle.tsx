"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE_NAME, type ThemeMode } from "@/lib/theme";

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <path d="M12 2a10 10 0 1 0 10 10 8 8 0 0 1-10-10z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="4" strokeWidth="1.8" />
      <path
        d="M12 2v2.2M12 19.8V22M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2 12h2.2M19.8 12H22M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function persistTheme(theme: ThemeMode) {
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function ThemeToggle({ initialTheme }: { initialTheme: ThemeMode }) {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const label =
    theme === "dark" ? "Dark mode enabled. Switch to light mode" : "Light mode enabled. Switch to dark mode";

  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink/20 bg-white/70 text-ink shadow-sm transition hover:border-ocean dark:border-white/20 dark:bg-white/10 dark:text-white"
    >
      {theme === "dark" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
