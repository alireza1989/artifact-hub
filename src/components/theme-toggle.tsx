"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// Light/dark toggle (PLAN Phase 6.8). Renders a stable placeholder until mounted
// — the server doesn't know the theme, so painting an icon early would mismatch.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <Button variant="ghost" size="icon-sm" aria-hidden="true" disabled />;
  }
  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
