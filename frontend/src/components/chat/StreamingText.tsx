"use client";

import { useEffect, useRef, useState } from "react";
import MarkdownRenderer from "./MarkdownRenderer";

interface Props {
  text: string;
}

const MIN_INTERVAL_MS = 150;

/**
 * 流式渲染：与结束态共用同一条 Markdown 渲染路径，只是对刷新频率做节流。
 * 之前这里是纯文本打字机，会先暴露 ## ** | 等 Markdown 源码，结束时再整段跳变。
 */
export default function StreamingText({ text }: Props) {
  const [shown, setShown] = useState(text);
  const shownRef = useRef(text);
  const latestRef = useRef(text);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  latestRef.current = text;

  useEffect(() => {
    // 内容缩短（新消息 / 重置）时立即同步，不做节流
    if (text.length < shownRef.current.length) {
      shownRef.current = text;
      setShown(text);
      return;
    }

    if (timerRef.current) return;

    timerRef.current = setTimeout(
      () => {
        timerRef.current = null;
        shownRef.current = latestRef.current;
        setShown(latestRef.current);
      },
      // 落后太多说明积压，立刻补上，避免"追不上"的观感
      text.length - shownRef.current.length > 400 ? 0 : MIN_INTERVAL_MS
    );
  }, [text]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return <MarkdownRenderer content={shown} />;
}
