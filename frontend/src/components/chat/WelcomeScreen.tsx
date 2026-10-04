"use client";

import { CapabilityCard } from "@/lib/types";
import CapabilityCardComponent from "@/components/common/CapabilityCard";

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
}

export default function WelcomeScreen({ onPromptClick }: Props) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[var(--content-width)] px-6 pb-12 pt-[10vh]">
        <div className="flex items-center gap-2">
          <span className="ic-tag ic-tag-go">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-go" />
            就绪
          </span>
          <span className="ic-metric">只读网页采集已接入</span>
        </div>

        <h1 className="mt-4 text-[26px] font-semibold tracking-tight text-ink-900">
          今天要追踪哪条技术动态
        </h1>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-ink-500">
          已接入只读网页采集 MCP（发版页 / 社区热帖 / 论文摘要），所有结论附来源链接。
          选择下面的指令开始，或直接描述你要追踪的对象。
        </p>

        <div className="mt-8 space-y-2">
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
    </div>
  );
}
