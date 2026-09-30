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
    description: "多来源特性覆盖度对比，产出带图表的可追溯研报",
    prompt: "对比 LangGraph 与 CrewAI 的特性覆盖度，生成带图表的研报",
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
            <span className="ic-label">技术情报控制台</span>
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
              今天要追踪哪条技术动态
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
              已接入只读网页采集 MCP（发版页 / 社区热帖 / 论文摘要），
              所有结论附来源链接。选择下面的指令开始，或直接描述你要追踪的对象。
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
