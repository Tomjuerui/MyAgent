"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

interface Props {
  content: string;
}

export default function MessageActions({ content }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 非安全上下文下 clipboard 不可用，静默降级
    }
  }, [content]);

  return (
    <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button type="button" onClick={copy} className="ic-icon-btn" aria-label="复制回复">
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}
