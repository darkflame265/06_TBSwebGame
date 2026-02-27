import { useEffect, useState } from "react";

const KEY_MUTED = "tbs-muted";
const KEY_DARK = "tbs-dark";

export function useMatchPreferences() {
  const [muted, setMuted] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const savedMuted = localStorage.getItem(KEY_MUTED);
    if (savedMuted) setMuted(savedMuted === "1");
    const savedDark = localStorage.getItem(KEY_DARK);
    if (savedDark) setDarkMode(savedDark === "1");
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY_MUTED, muted ? "1" : "0");
  }, [muted]);

  useEffect(() => {
    localStorage.setItem(KEY_DARK, darkMode ? "1" : "0");
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return {
    muted,
    setMuted,
    darkMode,
    setDarkMode,
  };
}
