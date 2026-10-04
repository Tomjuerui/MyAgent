"use client";

import { BRAND } from "@/lib/brand";

// 品牌图形：圆角方底 + 两道同心信号弧 + 中心点，语义是「采集 / 信号发射」。
// 同一图形另存为 src/app/icon.svg 供浏览器标签页使用，改这里时两边要同步。
function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient
          id="brand-mark-g"
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4285f4" />
          <stop offset="1" stopColor="#1a73e8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#brand-mark-g)" />
      <path
        d="M10.5 15.5A5.5 5.5 0 0 1 16 21"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M10.5 10.5A10.5 10.5 0 0 1 21 21"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="10.5" cy="21" r="2.2" fill="#fff" />
    </svg>
  );
}

export default function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <BrandMark />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[13.5px] font-medium leading-tight text-ink-900">
          {BRAND.name}
        </span>
        <span className="ic-metric leading-tight">{BRAND.tagline}</span>
      </div>
    </div>
  );
}
