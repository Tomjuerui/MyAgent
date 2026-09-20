"use client";

import { CapabilityCard } from "@/lib/types";
import CapabilityCardComponent from "@/components/common/CapabilityCard";

const CARDS: CapabilityCard[] = [
  {
    icon: "analysis",
    title: "供应商分析",
    description: "多维度比对供应商，产出可视化对比报告",
    prompt: "帮我对所有供应商进行综合分析，生成对比图表",
  },
  {
    icon: "order",
    title: "采购下单",
    description: "创建采购订单，缺字段会自动追问并走审批",
    prompt: "帮我新增一个采购订单",
  },
  {
    icon: "inventory",
    title: "库存预警",
    description: "监控库存水位，列出低于安全线的元器件",
    prompt: "查看当前库存预警信息",
  },
  {
    icon: "parts",
    title: "零部件查询",
    description: "检索零部件规格、价格与关联供应商",
    prompt: "查询所有零部件的库存和价格信息",
  },
];

interface Props {
  onPromptClick: (prompt: string) => void;
}

export default function WelcomeScreen({ onPromptClick }: Props) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 pt-[7vh] pb-10">
        {/* 系统状态 */}
        <div className="ic-panel">
          <div className="flex items-center justify-between px-4 py-2 border-b border-line-200">
            <span className="ic-label">采购控制台</span>
            <span className="ic-tag ic-tag-go">
              <span
                className="inline-block w-1.5 h-1.5"
                style={{ background: "var(--go)" }}
              />
              就绪
            </span>
          </div>
          <div className="px-4 py-4">
            <h1 className="text-[19px] font-medium tracking-tight text-ink-900">
              今天要先处理哪件事
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
              已接入 ERP 的供应商、订单、库存与零部件数据。
              选择下面的指令开始，或直接描述你要做的事。
            </p>
          </div>
        </div>

        {/* 常用指令 */}
        <div className="ic-panel mt-4">
          <div className="flex items-center justify-between px-4 py-2 border-b border-line-200">
            <span className="ic-label">常用指令</span>
            <span className="ic-metric">
              {String(CARDS.length).padStart(2, "0")}
            </span>
          </div>
          <div>
            {CARDS.map((card, idx) => (
              <CapabilityCardComponent
                key={card.title}
                card={card}
                index={idx}
                onClick={onPromptClick}
              />
            ))}
          </div>
        </div>

        <p className="ic-metric mt-3">Enter 发送 · Shift+Enter 换行</p>
      </div>
    </div>
  );
}
