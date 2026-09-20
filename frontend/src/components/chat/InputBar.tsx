"use client";

import { useState, useRef, useCallback } from "react";
import { CornerDownLeft } from "lucide-react";

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
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  return (
    <div className="border-t border-line-300 bg-surface-000">
      <div className="mx-auto w-full max-w-[1000px] px-8 py-3">
        <div className="flex items-end gap-2 px-3 py-2 border border-line-300 bg-surface-000 transition-colors focus-within:border-signal">
          <span className="ic-metric shrink-0 leading-7 select-none">&#62;</span>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled ? "正在处理，输入后将排队" : "输入指令，Enter 发送"
            }
            rows={1}
            className="flex-1 resize-none outline-none bg-transparent text-[13.5px] leading-7 text-ink-800 placeholder-ink-300 max-h-[120px]"
          />
          {queued > 0 && (
            <span className="ic-tag ic-tag-warn shrink-0 leading-5">{queued} 条排队</span>
          )}
          <button
            onClick={handleSend}
            disabled={!input.trim() || disabled}
            className="ic-btn shrink-0"
            aria-label="发送"
          >
            <CornerDownLeft size={13} />
            发送
          </button>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="ic-metric">Enter 发送</span>
          <span className="ic-metric">Shift+Enter 换行</span>
          <span className="ic-metric ml-auto">DeepAgent v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
