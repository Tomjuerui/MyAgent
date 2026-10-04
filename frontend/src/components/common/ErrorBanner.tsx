"use client";

import { AlertCircle, X } from "lucide-react";

interface Props {
  message: string;
  onDismiss: () => void;
}

export default function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <div className="animate-fade-in border-b border-line-200 bg-stop-soft">
      <div className="mx-auto flex w-full max-w-[var(--content-width)] items-start gap-2.5 px-6 py-3">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-stop" />
        <p className="min-w-0 flex-1 break-words text-[13.5px] leading-relaxed text-stop">
          {message}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="ic-icon-btn shrink-0"
          aria-label="关闭提示"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
