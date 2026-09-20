"use client";

interface Props {
  visible: boolean;
}

export default function ThinkingIndicator({ visible }: Props) {
  if (!visible) return null;

  return (
    <div className="animate-fade-in border-t border-line-200 bg-surface-050">
      <div className="mx-auto w-full max-w-[1000px] px-8 py-2.5">
        <div className="flex items-center gap-3 pl-3 border-l-[3px] border-signal">
          <span className="ic-scanbar w-12 shrink-0" />
          <span className="text-[13px] text-ink-700">正在解析意图</span>
          <span className="ic-metric">规划 · 调用 · 校验</span>
        </div>
      </div>
    </div>
  );
}
