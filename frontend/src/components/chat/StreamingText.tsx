"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  text: string;
  speed?: number; // 每帧显示的字符数（默认2）
}

/**
 * 打字机效果组件
 * 使用持久化 requestAnimationFrame 循环，不因 text 变化而取消动画
 * 解决：token 到达频率 > RAF 间隔时动画被反复取消导致文字一整块出现的 bug
 */
export default function StreamingText({ text, speed = 2 }: Props) {
  const [displayedCount, setDisplayedCount] = useState(0);
  const countRef = useRef(0);
  const targetRef = useRef(0);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  // 始终同步目标长度（不触发 effect）
  targetRef.current = text.length;

  // 启动一次持久动画循环（整个组件生命周期只启动一次）
  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    const animate = () => {
      const target = targetRef.current;
      const current = countRef.current;

      if (current < target) {
        // 智能追赶：差距大时加速，接近时逐字
        const gap = target - current;
        const increment = gap > 80 ? speed * 4 : gap > 40 ? speed * 3 : gap > 15 ? speed * 2 : speed;
        countRef.current = Math.min(current + increment, target);
        setDisplayedCount(countRef.current);
      }

      // 永不停止循环（组件卸载时才停止）
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      runningRef.current = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [speed]);

  // 新消息重置
  useEffect(() => {
    if (text.length === 0) {
      countRef.current = 0;
      setDisplayedCount(0);
    }
  }, [text]);

  // 等待状态（还没有任何文字）
  if (!text) {
    return <span className="ic-caret" />;
  }

  const displayedText = text.slice(0, displayedCount);
  const isComplete = displayedCount >= text.length;

  return (
    <span className="whitespace-pre-wrap">
      {displayedText}
      {!isComplete && <span className="ic-caret ml-0.5" />}
    </span>
  );
}
