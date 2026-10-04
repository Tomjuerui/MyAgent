"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "erp-theme";

export default function ThemeToggle() {
  // 服务端拿不到 document，先按浅色渲染，挂载后再对齐真实值，避免 hydration 不一致
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // 隐私模式下 localStorage 不可写，仅本次会话生效
    }
  };

  const label = dark ? "切换到浅色模式" : "切换到深色模式";

  return (
    <button
      onClick={toggle}
      className="ic-icon-btn"
      aria-label={label}
      title={label}
    >
      {mounted && dark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
