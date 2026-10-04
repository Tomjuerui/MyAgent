"use client";

import { ChevronRight } from "lucide-react";
import { CapabilityCard as CardType } from "@/lib/types";
import CapabilityIcon from "./CapabilityIcon";

interface Props {
  card: CardType;
  index: number;
  onClick: (prompt: string) => void;
}

export default function CapabilityCard({ card, index, onClick }: Props) {
  return (
    <button
      onClick={() => onClick(card.prompt)}
      className="group flex w-full items-center gap-3.5 rounded-[var(--radius-md)] border border-line-200 bg-surface-000 px-4 py-3 text-left shadow-xs transition-[border-color,box-shadow,transform] duration-150 hover:border-line-300 hover:shadow-sm active:scale-[0.995]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-100 text-ink-500 transition-colors group-hover:bg-signal-soft group-hover:text-signal">
        <CapabilityIcon name={card.icon} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-snug text-ink-800">
          {card.title}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-400">
          {card.description}
        </span>
      </span>
      <ChevronRight
        size={16}
        className="shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-signal"
      />
    </button>
  );
}
