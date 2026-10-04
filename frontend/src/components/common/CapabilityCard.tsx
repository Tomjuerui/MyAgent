"use client";

import { CapabilityCard as CardType } from "@/lib/types";
import CapabilityIcon from "./CapabilityIcon";

interface Props {
  card: CardType;
  index: number;
  onClick: (prompt: string) => void;
}

// 空态下的「指令 chips」：只保留图标 + 标题，说明文字挂到 title 上做悬浮提示。
// 原先是全宽带边框方框 + 两行文字，读起来像功能菜单，抢了 hero 的视觉重量。
export default function CapabilityCard({ card, index, onClick }: Props) {
  return (
    <button
      onClick={() => onClick(card.prompt)}
      title={card.description}
      className="group flex items-center gap-2 rounded-full border border-line-200 bg-surface-000/70 px-3.5 py-2 backdrop-blur-sm transition-[border-color,background-color,transform] duration-150 hover:border-line-300 hover:bg-surface-000 active:scale-[0.98]"
    >
      <span className="shrink-0 text-ink-400 transition-colors group-hover:text-signal">
        <CapabilityIcon name={card.icon} size={15} />
      </span>
      <span className="whitespace-nowrap text-[13px] text-ink-600 transition-colors group-hover:text-ink-800">
        {card.title}
      </span>
    </button>
  );
}
