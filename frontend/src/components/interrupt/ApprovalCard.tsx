"use client";

import { ShieldCheck, Check, X, Globe } from "lucide-react";
import { InterruptData } from "@/lib/types";

interface Props {
  data: InterruptData;
  onApprove: () => void;
  onReject: () => void;
}

// 浏览器类工具的审批卡文案：让审批人一眼看出拦的是哪次外部访问，
// 而不是把原始的 mcp_browser_navigate 工具名直接怼到脸上。
const BROWSER_TOOL_TITLES: Record<string, string> = {
  mcp_browser_navigate: "访问外部网站审批",
  mcp_extract_table: "提取网页表格审批",
  mcp_take_screenshot: "网页截图审批",
};

function hostOf(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

export default function ApprovalCard({ data, onApprove, onReject }: Props) {
  const orderData = data.order_data || data.tool_args || {};
  const rows = Object.entries(orderData);

  const title = BROWSER_TOOL_TITLES[data.tool_name ?? ""] ?? "订单审批确认";
  // orderData 已合并 order_data / tool_args 两处来源（主 Agent 兜底中断与
  // 子 Agent 定向中断的参数落在不同字段），域名统一从这里取。
  const targetHost = hostOf(orderData.url);
  const isBrowserTool = (data.tool_name ?? "") in BROWSER_TOOL_TITLES;

  return (
    <div className="animate-fade-in border-t border-line-200 bg-surface-000">
      <div className="mx-auto w-full max-w-[var(--content-width)] px-6 py-3">
        <div className="ic-panel ic-accent-signal">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line-200 bg-surface-050">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-signal" />
              <span className="text-[13px] font-medium text-ink-800">
                {title}
              </span>
              {data.tool_name && (
                <span className="ic-metric">{data.tool_name}</span>
              )}
            </div>
            <span className="ic-tag ic-tag-signal">待审批</span>
          </div>

          <div className="px-3 py-2.5">
            {isBrowserTool && targetHost && (
              <div className="mb-3 flex items-center gap-2 border border-signal/40 bg-signal/5 px-2.5 py-1.5">
                <Globe size={13} className="shrink-0 text-signal" />
                <span className="ic-label shrink-0">待访问域名</span>
                <span className="font-mono text-[13px] font-medium text-signal break-all">
                  {targetHost}
                </span>
              </div>
            )}

            {rows.length > 0 && (
              <table className="w-full border-collapse mb-3">
                <tbody>
                  {rows.map(([key, value]) => (
                    <tr key={key} className="border-b border-line-200 last:border-0">
                      <td className="py-1.5 pr-4 align-top whitespace-nowrap">
                        <span className="ic-label">{key}</span>
                      </td>
                      <td className="py-1.5 text-[12.5px] text-ink-800 break-all">
                        {typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="flex gap-2">
              <button onClick={onApprove} className="ic-btn">
                <Check size={13} />
                批准执行
              </button>
              <button onClick={onReject} className="ic-btn ic-btn-stop">
                <X size={13} />
                拒绝
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
