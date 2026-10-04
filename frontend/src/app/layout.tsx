import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { BRAND } from "@/lib/brand";
import "./globals.css";

// 西文用 Outfit：几何无衬线，与 Google Sans 同气质。构建期打包，不依赖用户本地字体。
// 中文没有对应字重，按字形回落到系统黑体（见 globals.css 的 --font-sans）。
const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${BRAND.name} - ${BRAND.tagline}`,
  description: BRAND.description,
};

// 首帧前定主题：放到 <head> 里同步执行，否则刷新会先闪一帧白底再翻成暗色
const THEME_INIT = `(function(){try{var t=localStorage.getItem("erp-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${outfit.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
