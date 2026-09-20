"use client";

interface Props {
  show: boolean;
  onToggle: (v: boolean) => void;
}

export default function ToolCallToggle({ show, onToggle }: Props) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span className="text-[12px] text-ink-500">显示工具调用</span>
      <button
        type="button"
        role="switch"
        aria-checked={show}
        data-on={show}
        onClick={() => onToggle(!show)}
        className="ic-switch"
      />
    </label>
  );
}
