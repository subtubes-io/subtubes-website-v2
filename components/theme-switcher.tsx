"use client";

import { useState, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { FormError } from "@/components/ui/form-error";

const storageKey = "subtubes-theme";
const themeEvent = "subtubes-theme-change";
type Theme = "light" | "dark";

function snapshot(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void) {
  function sync(event: StorageEvent) {
    if (event.key !== storageKey && event.key !== null) return;
    document.documentElement.dataset.theme = event.newValue === "light" ? "light" : "dark";
    onChange();
  }
  window.addEventListener(themeEvent, onChange);
  window.addEventListener("storage", sync);
  return () => {
    window.removeEventListener(themeEvent, onChange);
    window.removeEventListener("storage", sync);
  };
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "dark");
  const [error, setError] = useState("");
  return (
    <div className="theme-control">
      <button type="button" role="switch" className="theme-switcher"
        aria-label="Dark mode"
        aria-checked={theme === "dark"}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        onClick={() => {
          const next = theme === "dark" ? "light" : "dark";
          document.documentElement.dataset.theme = next;
          window.dispatchEvent(new Event(themeEvent));
          setError("");
          try {
            localStorage.setItem(storageKey, next);
          } catch {
            setError("Theme changed, but could not be saved in this browser.");
          }
        }}>
        <span className="theme-toggle-thumb" aria-hidden="true" />
        <Sun className="theme-icon theme-icon-sun" size={22} aria-hidden="true" />
        <Moon className="theme-icon theme-icon-moon" size={22} aria-hidden="true" />
      </button>
      {error && <FormError className="theme-error">{error}</FormError>}
    </div>
  );
}
