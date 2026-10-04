"use client";

import { useState, useRef, useCallback } from "react";
import { ArrowUp } from "lucide-react";

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  queued?: number;
}

export default function InputBar({ onSend, disabled, queued = 0 }: Props) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (!input.trim() || disabled) return;
    onSend(input);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const canSend = !!input.trim() && !disabled;

  return (
    <div className="bg-surface-000">
      <div className="mx-auto w-full max-w-[var(--content-width)] px-6 pb-4 pt-2">
        <div className="flex items-end gap-2 rounded-[18px] border border-line-300 bg-surface-000 px-3 py-2 shadow-sm transition-colors focus-within:border-signal">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled ? "正在处理，输入后将排队" : "输入指令，Enter 发送"
            }
            rows={1}
            className="max-h-[160px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-ink-800 outline-none placeholder:text-ink-300"
          />
          {queued > 0 && (
            <span className="ic-tag ic-tag-warn mb-1 shrink-0">
              {queued} 条排队
            </span>
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="发送"
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-signal text-white transition-[background-color,transform] duration-150 hover:bg-signal-hi active:scale-95 disabled:cursor-not-allowed disabled:bg-surface-200 disabled:text-ink-300"
          >
            <ArrowUp size={16} />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3 px-1">
          <span className="ic-metric">Enter 发送</span>
          <span className="ic-metric">Shift+Enter 换行</span>
        </div>
      </div>
    </div>
  );
}
