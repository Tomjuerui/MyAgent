"use client";

import { useCallback, useState } from "react";
import { Check, Copy, Download } from "lucide-react";

interface Props {
  content: string;
}

// 下载文件名：取正文首个一级标题，退化到「研报-日期」。
// 标题里可能带 Windows 禁用字符（\/:*?"<>|），一律换成下划线，避免下载被拦。
function markdownFileName(content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const base = heading?.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60);
  if (base) return `${base}.md`;
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `采购分析-${stamp}.md`;
}

export default function MessageActions({ content }: Props) {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 非安全上下文下 clipboard 不可用，静默降级
    }
  }, [content]);

  // 纯前端导出：把这条回复的完整 markdown 落成一个 .md 文件，
  // 不依赖后端是否调过 generate_document，历史消息同样可下载。
  const download = useCallback(() => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = markdownFileName(content);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 1600);
  }, [content]);

  return (
    <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button type="button" onClick={copy} className="ic-icon-btn" aria-label="复制回复">
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "已复制" : "复制"}
      </button>
      <button
        type="button"
        onClick={download}
        className="ic-icon-btn"
        aria-label="下载采购分析 Markdown"
      >
        {downloaded ? <Check size={13} /> : <Download size={13} />}
        {downloaded ? "已下载" : "下载"}
      </button>
    </div>
  );
}
