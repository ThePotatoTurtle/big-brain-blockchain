"use client";

import { useState, useEffect, useRef } from "react";
import { THEMES, THEME_STORAGE_KEY, THEME_TTL_MS } from "@/lib/themes";

export default function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("midnight");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrent(document.documentElement.getAttribute("data-theme") || "midnight");
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selectTheme = (id: string) => {
    document.documentElement.setAttribute("data-theme", id);
    try {
      localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ theme: id, expires: Date.now() + THEME_TTL_MS })
      );
    } catch {
      // localStorage unavailable (private mode, etc.) — selection just won't persist
    }
    setCurrent(id);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Choose color theme"
        className="w-9 h-9 flex items-center justify-center rounded-lg text-base leading-none hover:bg-card-hover transition-colors"
      >
        🎨
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-44 bg-card border border-border rounded-lg shadow-lg py-1.5 z-50">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTheme(t.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-card-hover transition-colors ${
                current === t.id ? "text-accent font-medium" : "text-foreground"
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: t.swatch }}
              />
              {t.name}
              {current === t.id && (
                <svg
                  className="w-3.5 h-3.5 ml-auto shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
