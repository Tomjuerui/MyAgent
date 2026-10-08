"use client";

import { useEffect, useState } from "react";
import { CapabilityCard } from "@/lib/types";
import CapabilityCardComponent from "@/components/common/CapabilityCard";
import { getProfile } from "@/lib/api";

const USER_ID = "user-001";

const CARDS: CapabilityCard[] = [
  {
    icon: "inventory",
    title: "库存预警查询",
    description: "查出所有低于安全库存的元器件，给出补货建议",
    prompt: "查一下当前库存预警，哪些元器件低于安全库存，建议补多少",
  },
  {
    icon: "order",
    title: "创建采购订单",
    description: "按需求创建采购订单，走人工审批流程",
    prompt: "帮我采购 100 个 STM32 主控芯片，创建采购订单",
  },
  {
    icon: "analysis",
    title: "供应商分析对比",
    description: "对比供应商信用评级与供货能力，生成图表报告",
    prompt: "对比几家供应商的信用评级和供货能力，生成图表报告",
  },
];

interface Props {
  onPromptClick: (prompt: string) => void;
  /** 空态输入框。传进来而不是固定钉在底部，才能让标题与输入框同屏。 */
  children?: React.ReactNode;
}

export default function WelcomeScreen({ onPromptClick, children }: Props) {
  const [quickPrompt, setQuickPrompt] = useState<string | null>(null);

  useEffect(() => {
    getProfile(USER_ID)
      .then((p) => setQuickPrompt(p.quick_report_prompt))
      .catch(() => setQuickPrompt(null));
  }, []);

  const chips: CapabilityCard[] = quickPrompt
    ? [
        {
          icon: "analysis",
          title: "快速采购分析",
          description: "基于你的画像一键生成采购分析",
          prompt: quickPrompt,
        },
        ...CARDS,
      ]
    : CARDS;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[var(--content-width)] flex-col justify-center px-6 pb-14 pt-8">
        <h1 className="text-center text-[30px] font-normal leading-[1.25] tracking-tight text-ink-700 md:text-[38px]">
          今天要处理什么采购任务
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-center text-[14px] leading-relaxed text-ink-400">
          供应商 / 元器件 / 采购订单 / 库存，全程人工审批、订单流转可追溯
        </p>

        <div className="mt-9">{children}</div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {chips.map((card, idx) => (
            <CapabilityCardComponent
              key={card.title}
              card={card}
              index={idx}
              onClick={onPromptClick}
            />
          ))}
        </div>

        <div className="mt-7 flex items-center justify-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-go" />
          <span className="ic-metric">ERP 数据台已接入，人机操作实时可见</span>
        </div>
      </div>
    </div>
  );
}
