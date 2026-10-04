"use client";

interface Props {
  visible: boolean;
  label?: string;
}

export default function ThinkingIndicator({ visible, label }: Props) {
  if (!visible) return null;

  return (
    <div className="animate-fade-in bg-surface-000">
      <div className="mx-auto flex w-full max-w-[var(--content-width)] items-center gap-3 px-6 py-2.5">
        <span className="ic-scanbar w-10 shrink-0" />
        <span className="text-[13.5px] text-ink-600">{label || "正在处理"}</span>
      </div>
    </div>
  );
}
