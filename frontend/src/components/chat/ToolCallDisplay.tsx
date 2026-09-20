"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, SquareCheck } from "lucide-react";
import { ToolCallInfo } from "@/lib/types";

interface Props {
  toolCall: ToolCallInfo;
}

export default function ToolCallDisplay({ toolCall }: Props) {
  const [expanded, setExpanded] = useState(false);
  const running = toolCall.status === "running";

  return (
    <div className="my-1 border border-line-300 bg-surface-000">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-surface-100 hover:bg-surface-200 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-ink-400 shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-ink-400 shrink-0" />
        )}
        <span className="font-mono text-[12px] text-ink-800 truncate">
          {toolCall.name}
        </span>
        {running ? (
          <span className="ic-tag ic-tag-signal ml-auto">
            <Loader2 size={11} className="animate-spin" />
            运行中
          </span>
        ) : (
          <span className="ic-tag ic-tag-go ml-auto">
            <SquareCheck size={11} />
            完成
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-2.5 py-2 space-y-2 border-t border-line-200">
          {toolCall.args && (
            <div>
              <span className="ic-label">参数</span>
              <pre className="ic-data mt-1">{formatJSON(toolCall.args)}</pre>
            </div>
          )}
          {toolCall.result && (
            <div>
              <span className="ic-label">结果</span>
              <pre className="ic-data mt-1 max-h-40 overflow-y-auto">
                {formatJSON(toolCall.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatJSON(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}
