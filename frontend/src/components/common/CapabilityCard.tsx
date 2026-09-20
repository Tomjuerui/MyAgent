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
      className="ic-row w-full text-left group"
    >
      <span className="ic-metric w-5 shrink-0">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="text-ink-400 group-hover:text-signal shrink-0 transition-colors">
        <CapabilityIcon name={card.icon} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] leading-snug text-ink-800 group-hover:text-signal transition-colors">
          {card.title}
        </span>
        <span className="block text-[12px] leading-snug text-ink-400 mt-0.5">
          {card.description}
        </span>
      </span>
      <ChevronRight
        size={14}
        className="shrink-0 text-ink-300 group-hover:text-signal group-hover:translate-x-0.5 transition-all"
      />
    </button>
  );
}
