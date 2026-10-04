import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "智能采购助手 - ERP Agent",
  description: "基于 Harness Engineering 架构的智能采购助手",
};

// 首帧前定主题：放到 <head> 里同步执行，否则刷新会先闪一帧白底再翻成暗色
const THEME_INIT = `(function(){try{var t=localStorage.getItem("erp-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
