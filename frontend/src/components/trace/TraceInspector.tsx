"use client";

import { TraceSpan } from "@/lib/types";
import {
  badgeClass,
  badgeLabel,
  browserMetrics,
  fmtDuration,
  fmtTokens,
  KIND_LABEL,
  nameOf,
} from "@/lib/trace-utils";

interface Props {
  span: TraceSpan | null;
}

export default function TraceInspector({ span }: Props) {
  if (!span) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-ink-300">
        点击左侧任意一行，查看该步的模型、用量与出入参
      </div>
    );
  }

  const metrics = browserMetrics(span);
  const isLlm = span.kind === "llm";

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[10px] ${badgeClass(span)}`}>
          {badgeLabel(span)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-800">{nameOf(span)}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <Chip label={KIND_LABEL[span.kind] ?? span.kind} />
        {span.model && <Chip label={`model ${span.model}`} />}
        {span.node && <Chip label={`阶段 ${span.node}`} />}
        <Chip label={`agent ${span.agent}`} />
        {span.status !== "ok" && (
          <span className="rounded-[var(--radius-xs)] bg-warn-soft px-1.5 py-0.5 text-warn">{span.status}</span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="耗时" value={fmtDuration(span.duration_ms)} />
        <Metric label="tokens 进" value={fmtTokens(isLlm ? span.tokens_in : span.subtree_in)} />
        <Metric label="tokens 出" value={fmtTokens(isLlm ? span.tokens_out : span.subtree_out)} />
      </div>
      {!isLlm && (span.subtree_total > 0 || span.tokens_total > 0) && (
        <div className="mt-1.5 text-[11px] text-ink-500">
          自身 tokens {fmtTokens(span.tokens_total)} · 含子项 {fmtTokens(span.subtree_total)}
        </div>
      )}

      {metrics && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {metrics.elapsedMs !== undefined && (
            <Chip label={`网站响应 ${fmtDuration(metrics.elapsedMs)}`} />
          )}
          {metrics.chars !== undefined && <Chip label={`提取字符 ${metrics.chars.toLocaleString()}`} />}
          {metrics.rows && <Chip label={`表格行数 ${metrics.rows.join(" / ")}`} />}
        </div>
      )}

      {span.error && (
        <Section title="错误">
          <div className="break-all text-[12px] text-stop">{span.error}</div>
        </Section>
      )}
      {span.args_preview && (
        <Section title="入参">
          <pre className="ic-data">{span.args_preview}</pre>
        </Section>
      )}
      {span.result_preview && (
        <Section title="出参">
          <pre className="ic-data">{span.result_preview}</pre>
        </Section>
      )}
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return <span className="rounded-[var(--radius-xs)] border border-line-200 bg-surface-000 px-1.5 py-0.5 text-ink-500">{label}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-surface-050 px-2 py-1.5">
      <div className="text-[10px] text-ink-400">{label}</div>
      <div className="font-mono text-[13px] text-ink-800">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] text-ink-400">{title}</div>
      {children}
    </div>
  );
}
