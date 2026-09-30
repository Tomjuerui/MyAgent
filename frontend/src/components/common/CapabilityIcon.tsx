"use client";

import { CapabilityCard } from "@/lib/types";

type IconKey = CapabilityCard["icon"];

const PATHS: Record<IconKey, React.ReactNode> = {
  // 供应商分析 — 三条对比柱
  analysis: (
    <>
      <line x1="3" y1="21" x2="21" y2="21" />
      <line x1="6" y1="21" x2="6" y2="13" />
      <line x1="12" y1="21" x2="12" y2="6" />
      <line x1="18" y1="21" x2="18" y2="15" />
    </>
  ),
  // 采购下单 — 订单单据
  order: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" />
      <line x1="8" y1="8.5" x2="16" y2="8.5" />
      <line x1="8" y1="12.5" x2="16" y2="12.5" />
      <line x1="8" y1="16.5" x2="13" y2="16.5" />
    </>
  ),
  // 库存预警 — 等距货箱
  inventory: (
    <>
      <path d="M3.5 7.8 12 3l8.5 4.8v8.4L12 21l-8.5-4.8z" />
      <line x1="3.5" y1="7.8" x2="12" y2="12.6" />
      <line x1="12" y1="12.6" x2="20.5" y2="7.8" />
      <line x1="12" y1="12.6" x2="12" y2="21" />
    </>
  ),
  // 零部件查询 — 元器件芯片
  parts: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" />
      <rect x="10.5" y="10.5" width="3" height="3" />
      <line x1="9.5" y1="3" x2="9.5" y2="6.5" />
      <line x1="14.5" y1="3" x2="14.5" y2="6.5" />
      <line x1="9.5" y1="17.5" x2="9.5" y2="21" />
      <line x1="14.5" y1="17.5" x2="14.5" y2="21" />
      <line x1="3" y1="9.5" x2="6.5" y2="9.5" />
      <line x1="3" y1="14.5" x2="6.5" y2="14.5" />
      <line x1="17.5" y1="9.5" x2="21" y2="9.5" />
      <line x1="17.5" y1="14.5" x2="21" y2="14.5" />
    </>
  ),
  // 发版追踪 — 版本标签
  release: (
    <>
      <path d="M3.5 11.5V4.5h7l10 10-7 7z" />
      <circle cx="8" cy="8.5" r="1.4" />
    </>
  ),
  // 社区舆情 — 对话气泡
  sentiment: (
    <>
      <path d="M3.5 5.5h17v10h-9l-5 4v-4h-3z" />
      <line x1="7.5" y1="9" x2="16.5" y2="9" />
      <line x1="7.5" y1="12.5" x2="13.5" y2="12.5" />
    </>
  ),
};

interface Props {
  name: IconKey;
  size?: number;
}

export default function CapabilityIcon({ name, size = 16 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className="shrink-0"
    >
      {PATHS[name]}
    </svg>
  );
}
