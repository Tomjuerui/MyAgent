"use client";

export default function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-signal">
        <span className="text-[15px] font-medium leading-none text-white">采</span>
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[13.5px] font-medium leading-tight text-ink-900">
          智能采购助手
        </span>
        <span className="ic-metric leading-tight">ERP Agent</span>
      </div>
    </div>
  );
}
