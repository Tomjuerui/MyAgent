"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  reasoning: string;
  streaming?: boolean;
}

// 思考型模型的推理链：流式期默认展开并跟随滚动（让用户看到实时活动），
// 本轮结束后自动折叠；用户一旦手动开合，就不再自动干预。
export default function ReasoningBlock({ reasoning, streaming }: Props) {
  const [expanded, setExpanded] = useState(!!streaming);
  const bodyRef = useRef<HTMLDivElement>(null);
  const userToggledRef = useRef(false);

  useEffect(() => {
    if (streaming) {
      setExpanded(true);
    } else if (!userToggledRef.current) {
      setExpanded(false);
    }
  }, [streaming]);

  useEffect(() => {
    if (expanded && streaming) {
      const el = bodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [reasoning, expanded, streaming]);

  const label = streaming ? "思考中…" : "思考过程";

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-line-200 bg-surface-050">
      <button
        type="button"
        onClick={() => {
          userToggledRef.current = true;
          setExpanded((v) => !v);
        }}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="ic-metric">
          {label} · {reasoning.length} 字
        </span>
      </button>
      {expanded && (
        <div
          ref={bodyRef}
          className="max-h-52 overflow-y-auto whitespace-pre-wrap border-t border-line-200 px-3 py-2 text-[13px] leading-6 italic text-ink-500"
        >
          {reasoning}
        </div>
      )}
    </div>
  );
}
