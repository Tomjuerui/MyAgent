"use client";

import { ChevronDown, ChevronRight, Loader2, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { ToolCallInfo } from "@/lib/types";

interface Props {
  toolCall: ToolCallInfo;
}

// 工具名 → 人话。与 ApprovalCard 的 BROWSER_TOOL_TITLES 保持同一套说法。
const TOOL_TITLES: Record<string, string> = {
  mcp_browser_navigate: "访问外部网站",
  mcp_extract_table: "提取网页表格",
  mcp_take_screenshot: "网页截图",
  generate_chart: "生成图表",
  document_generator: "生成文档",
  download_sandbox_file: "提取沙箱文件",
  web_search: "联网搜索",
  web_fetch: "抓取网页",
  write_todos: "更新计划",
  task: "子智能体",
  execute: "沙箱执行",
};

function toolTitle(name: string): string {
  if (TOOL_TITLES[name]) return TOOL_TITLES[name];
  if (name.startsWith("mcp_browser_")) return "网页采集";
  if (name.startsWith("mcp_")) return name.slice(4).replace(/_/g, " ");
  return name.replace(/_/g, " ");
}

export default function ToolCallDisplay({ toolCall }: Props) {
  const [expanded, setExpanded] = useState(false);
  const running = toolCall.status === "running";

  return (
    <div className="overflow-hidden rounded-[var(--radius-sm)] border border-line-200 bg-surface-050">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-100"
      >
        {expanded ? (
          <ChevronDown size={13} className="shrink-0 text-ink-400" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-ink-400" />
        )}
        <span className="truncate text-[12.5px] text-ink-600">
          {toolTitle(toolCall.name)}
        </span>
        {running ? (
          <span className="ic-tag ic-tag-signal ml-auto shrink-0">
            <Loader2 size={11} className="animate-spin" />
            运行中
          </span>
        ) : (
          <span className="ic-tag ic-tag-go ml-auto shrink-0">
            <CheckCircle2 size={11} />
            完成
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-2.5 border-t border-line-200 px-3 py-2.5">
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
