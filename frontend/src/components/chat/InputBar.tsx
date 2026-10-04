"use client";

import { useState, useRef, useCallback } from "react";
import { ArrowUp } from "lucide-react";

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  queued?: number;
  /** inline：空态 hero 内使用，不粘底、不带上下留白；docked：会话态粘底 */
  variant?: "docked" | "inline";
}

export default function InputBar({
  onSend,
  disabled,
  queued = 0,
  variant = "docked",
}: Props) {
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
    <div className={variant === "docked" ? "pt-2 pb-4" : ""}>
      <div className="mx-auto w-full max-w-[var(--content-width)] px-6">
        <div className="flex items-end gap-2 rounded-[30px] border border-line-200 bg-surface-000 py-2 pl-5 pr-2 shadow-[var(--shadow-md)] transition-shadow duration-200 focus-within:shadow-[var(--shadow-lg)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled ? "正在处理，输入后将排队" : "输入指令，Enter 发送"
            }
            rows={1}
            className="max-h-[160px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-ink-800 outline-none placeholder:text-ink-300"
          />
          {queued > 0 && (
            <span className="ic-tag ic-tag-warn mb-2 shrink-0">
              {queued} 条排队
            </span>
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="发送"
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-signal text-on-signal transition-[background-color,transform] duration-150 hover:bg-signal-hi active:scale-95 disabled:cursor-not-allowed disabled:bg-surface-200 disabled:text-ink-300"
          >
            <ArrowUp size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
