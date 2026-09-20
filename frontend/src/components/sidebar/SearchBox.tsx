"use client";

import { Search } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function SearchBox({ value, onChange }: Props) {
  return (
    <div className="px-4 py-2">
      <div className="flex items-center gap-2 px-2.5 border border-line-300 bg-surface-000 transition-colors focus-within:border-signal">
        <Search size={13} className="text-ink-300 shrink-0" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="搜索对话"
          className="w-full py-1.5 bg-transparent outline-none text-[13px] text-ink-800 placeholder-ink-300"
        />
      </div>
    </div>
  );
}
