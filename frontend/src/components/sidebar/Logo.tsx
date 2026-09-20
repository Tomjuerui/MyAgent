"use client";

export default function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4 border-b border-line-200">
      <div
        className="w-8 h-8 flex items-center justify-center shrink-0"
        style={{ background: "var(--signal)" }}
      >
        <span className="text-[15px] text-[#eaf2f6] leading-none">采</span>
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] font-medium text-ink-900 leading-tight truncate">
          智能采购助手
        </span>
        <span className="ic-metric leading-tight">ERP Agent</span>
      </div>
    </div>
  );
}
