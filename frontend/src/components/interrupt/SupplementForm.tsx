"use client";

import { useState } from "react";
import { AlertCircle, CornerDownLeft } from "lucide-react";
import { InterruptData } from "@/lib/types";

interface Props {
  data: InterruptData;
  onSubmit: (supplement: string) => void;
}

export default function SupplementForm({ data, onSubmit }: Props) {
  const [text, setText] = useState("");

  const handleSubmit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setText("");
  };

  const hasExtracted =
    !!data.extracted_data && Object.keys(data.extracted_data).length > 0;

  return (
    <div className="animate-fade-in border-t border-line-200 bg-surface-000">
      <div className="mx-auto w-full max-w-[1000px] px-8 py-3">
        <div className="ic-panel ic-accent-warn">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line-200 bg-surface-050">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-warn" />
              <span className="text-[13px] font-medium text-ink-800">
                需要补充订单信息
              </span>
            </div>
            <span className="ic-tag ic-tag-warn">待补充</span>
          </div>

          <div className="px-3 py-2.5">
            {data.message && (
              <p className="text-[12.5px] text-ink-600 mb-2">{data.message}</p>
            )}

            {data.missing_fields && data.missing_fields.length > 0 && (
              <div className="mb-2">
                <span className="ic-label">缺少字段</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {data.missing_fields.map((f) => (
                    <span key={f} className="ic-tag ic-tag-warn">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {hasExtracted && (
              <div className="mb-2">
                <span className="ic-label">已提取数据</span>
                <pre className="ic-data mt-1">
                  {JSON.stringify(data.extracted_data, null, 2)}
                </pre>
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="补充内容，例如：零部件 P001，数量 100，单价 25.5"
                className="ic-input flex-1"
              />
              <button
                onClick={handleSubmit}
                disabled={!text.trim()}
                className="ic-btn shrink-0"
              >
                <CornerDownLeft size={13} />
                提交
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
