"use client";

import { Search } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function SearchBox({ value, onChange }: Props) {
  return (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-line-200 bg-surface-000 px-2.5 transition-colors focus-within:border-signal">
        <Search size={13} className="shrink-0 text-ink-300" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="搜索对话"
          className="w-full bg-transparent py-1.5 text-[13px] text-ink-800 outline-none placeholder:text-ink-300"
        />
      </div>
    </div>
  );
}
