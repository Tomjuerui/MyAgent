"use client";

import {
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

// detect:false —— 只在代码块显式标注语言时高亮，避免自动嗅探拖慢流式渲染
const remarkPlugins: PluggableList = [remarkGfm];
const rehypePlugins: PluggableList = [
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];

// 表格分隔行，形如 |---|---| 或 |:--|--:|
const TABLE_DELIM_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * 修「表题被粘在表头行上」的坏 markdown：
 *   '### 表1：发版节奏对比表| 框架 | 版本 | … |'   ← 缺换行
 *   '|---|---|---|---|---|---|---|'
 * GFM 要求表头行独立成行；粘在一起时整行会被当成标题，后面所有数据行退化成
 * 带竖线的普通段落 —— 表格直接消失。生成端偶发这种写法，历史消息已经这样存进库了，
 * 所以在渲染前归一化，而不是等重新生成。
 */
function repairGluedTableHeaders(md: string): string {
  const lines = md.split("\n");
  let changed = false;
  for (let i = 1; i < lines.length; i++) {
    const delim = lines[i];
    // 只处理「下一行是真正的表格分隔行」的位置，且分隔行必须带竖线（排除 --- 水平分割线）
    if (!delim.includes("|") || !TABLE_DELIM_ROW.test(delim)) continue;
    const prev = lines[i - 1];
    // 合规的表头行本身以 | 开头；含 | 却不以 | 开头 = 前面粘了表题
    if (!prev.includes("|") || prev.trimStart().startsWith("|")) continue;
    const cut = prev.indexOf("|");
    lines[i - 1] = `${prev.slice(0, cut).trimEnd()}\n${prev.slice(cut).trimStart()}`;
    changed = true;
  }
  return changed ? lines.join("\n") : md;
}

// 围栏代码块开/关行（``` 或 ~~~）
const FENCE_LINE = /^\s*(```|~~~)/;
// ATX 标题漏空格，形如 '###一、' '####1.1'。首位排除空格/#/!：
// 7 个及以上的 # 本来就不是标题，#!/bin/bash 是 shebang 不是标题。
const ATX_MISSING_SPACE = /^(#{1,6})(?=[^\s#!])/;

/**
 * 修「ATX 标题漏空格」的坏 markdown：
 *   '###一、当日新增（2026-10-04）'  →  '### 一、当日新增（2026-10-04）'
 * CommonMark 要求 # 号后必须有空格/制表符或行尾，漏掉时整行按普通段落解析，
 * 前端就表现为「标题没渲染，字号和正文一样」。生成端时好时坏（带空格的那次正常），
 * 历史消息已按原样存进库，所以在渲染前归一化，而不是等重新生成。
 * 只认顶格的 #：缩进 4 格属于代码块，1~3 格缩进的标题本项目输出里不存在。
 */
function repairAtxHeadings(md: string): string {
  if (!md.includes("#")) return md;
  const lines = md.split("\n");
  let changed = false;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    // 代码块内的行首 # 是 shebang / 注释，补空格会把它变成标题
    if (inFence) continue;
    const match = ATX_MISSING_SPACE.exec(line);
    if (!match) continue;
    lines[i] = `${match[1]} ${line.slice(match[1].length)}`;
    changed = true;
  }
  return changed ? lines.join("\n") : md;
}

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);

  let language = "";
  let source = "";
  if (isValidElement(children)) {
    const props = children.props as { className?: string; children?: ReactNode };
    const match = /language-([\w+#.-]+)/.exec(props.className ?? "");
    if (match) language = match[1];
    source = extractText(props.children);
  }

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 非安全上下文下 clipboard 不可用，静默降级
    }
  }, [source]);

  return (
    <div className="md-code-block">
      <div className="md-code-head">
        <span>{language || "text"}</span>
        <button
          type="button"
          onClick={copy}
          className="ic-icon-btn"
          aria-label="复制代码"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

// 历史消息里的图表链接有三种写法：裸文件名、/download/x.png、/api/download/x.png。
// 前两种会打到前端域名上 404（表现为报告中间的裂图），统一归一化到后端产物路由。
function normalizeAssetSrc(src: string): string {
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  const base = src.split(/[?#]/)[0].split("/").pop();
  return base ? `/api/download/${base}` : src;
}

function ZoomOverlay({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 传送到 body：消息气泡上的 ic-in 动画带 transform，会截住 fixed 定位
  return createPortal(
    <div
      className="md-zoom"
      role="dialog"
      aria-modal="true"
      aria-label={alt || "图片预览"}
      onClick={onClose}
    >
      <img src={src} alt={alt} />
    </div>,
    document.body
  );
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const raw = typeof src === "string" ? src.trim() : "";
  if (!raw) return null;
  const resolved = normalizeAssetSrc(raw);
  // 图表文件确实不在产物目录时，给一行文字说明，别让裂图图标占着版面
  if (failed) {
    return <span className="md-img-missing">{alt || "图表"}（文件已不可用）</span>;
  }
  return (
    <>
      <img
        src={resolved}
        alt={alt ?? ""}
        loading="lazy"
        onError={() => setFailed(true)}
        onClick={() => setZoomed(true)}
      />
      {zoomed && (
        <ZoomOverlay
          src={resolved}
          alt={alt ?? ""}
          onClose={() => setZoomed(false)}
        />
      )}
    </>
  );
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  // 来源链接必须新窗口打开，否则会丢掉整个会话
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  ),
  img: ({ src, alt }) => (
    <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} />
  ),
};

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {repairAtxHeadings(repairGluedTableHeaders(content))}
    </ReactMarkdown>
  );
}

export default memo(MarkdownRenderer);
