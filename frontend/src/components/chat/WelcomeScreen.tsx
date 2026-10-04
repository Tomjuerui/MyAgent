"use client";

import { useEffect, useState } from "react";
import { CapabilityCard } from "@/lib/types";
import CapabilityCardComponent from "@/components/common/CapabilityCard";
import { getProfile } from "@/lib/api";

const USER_ID = "user-001";

const CARDS: CapabilityCard[] = [
  {
    icon: "release",
    title: "Agent 框架发版追踪",
    description: "采集主流框架 releases 页，提取版本表与变更条目",
    prompt: "分析上周主流 Agent 框架（LangGraph / CrewAI / AutoGen）的发版动态",
  },
  {
    icon: "sentiment",
    title: "社区舆情摘要",
    description: "抓取技术社区热帖，按热度量化汇总关注焦点",
    prompt: "抓取 HackerNews 今日 AI 相关热帖，输出舆情摘要",
  },
  {
    icon: "analysis",
    title: "技术路线对比研报",
    description: "多来源特性覆盖度对比，产出带图表和来源链接的研报",
    prompt: "对比 LangGraph 与 CrewAI 的特性覆盖度，生成带图表的研报",
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
          title: "快速生成研报",
          description: "基于你的画像一键生成个性化研报",
          prompt: quickPrompt,
        },
        ...CARDS,
      ]
    : CARDS;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[var(--content-width)] flex-col justify-center px-6 pb-14 pt-8">
        <h1 className="text-center text-[30px] font-normal leading-[1.25] tracking-tight text-ink-700 md:text-[38px]">
          今天要追踪哪条技术动态
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-center text-[14px] leading-relaxed text-ink-400">
          发版页 / 社区热帖 / 论文摘要，所有结论附来源链接
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
          <span className="ic-metric">只读网页采集已接入</span>
        </div>
      </div>
    </div>
  );
}
