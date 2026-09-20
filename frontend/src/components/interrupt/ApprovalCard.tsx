"use client";

import { ShieldCheck, Check, X } from "lucide-react";
import { InterruptData } from "@/lib/types";

interface Props {
  data: InterruptData;
  onApprove: () => void;
  onReject: () => void;
}

export default function ApprovalCard({ data, onApprove, onReject }: Props) {
  const orderData = data.order_data || data.tool_args || {};
  const rows = Object.entries(orderData);

  return (
    <div className="animate-fade-in border-t border-line-200 bg-surface-000">
      <div className="mx-auto w-full max-w-[1000px] px-8 py-3">
        <div className="ic-panel ic-accent-signal">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line-200 bg-surface-050">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-signal" />
              <span className="text-[13px] font-medium text-ink-800">
                订单审批确认
              </span>
              {data.tool_name && (
                <span className="ic-metric">{data.tool_name}</span>
              )}
            </div>
            <span className="ic-tag ic-tag-signal">待审批</span>
          </div>

          <div className="px-3 py-2.5">
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
