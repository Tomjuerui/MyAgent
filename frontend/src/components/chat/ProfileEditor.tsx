"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Plus, X } from "lucide-react";
import { getProfile, updateProfile } from "@/lib/api";
import MarkdownRenderer from "./MarkdownRenderer";

const USER_ID = "user-001";

// 后端 src/agent/profile.py 靠正则解析这份 markdown：
//   _extract_section(content, "追踪主题") 只认「## 追踪主题」段里以 - 开头的行
//   _extract_pref(content, key)           只认「- 图表类型: 值」这种「- key: 值」行
//   _merge_profile / _extract_section     依赖「## 备注」段
// 所以 buildProfileMd 输出的结构必须逐字保持，否则画像会静默失效且不报错。
const TOPIC_PLACEHOLDER =
  "（尚未提炼。继续对话，系统会自动识别你在追踪的技术方向。）";
const NOTES_PLACEHOLDER = "（用户自由补充，不会被自动提炼覆盖）";

const PREF_KEYS = ["图表类型", "输出格式", "语言"] as const;
type PrefKey = (typeof PREF_KEYS)[number];

const PREF_OPTIONS: Record<PrefKey, string[]> = {
  图表类型: ["柱状图", "折线图", "饼图", "散点图"],
  输出格式: ["Markdown + 表格", "Markdown", "纯文本"],
  语言: ["中文", "英文"],
};

type Prefs = Record<PrefKey, string>;

interface Props {
  open: boolean;
  onClose: () => void;
}

function parseTopics(content: string): string[] {
  const m = content.match(/##\s*追踪主题\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!m) return [];
  return m[1]
    .split("\n")
    .filter((ln) => ln.trim().startsWith("-"))
    .map((ln) => ln.replace(/^\s*-\s*/, "").trim())
    .filter((t) => t && !t.startsWith("（"));
}

function parsePrefs(content: string): Prefs {
  const get = (k: PrefKey): string => {
    const m = content.match(new RegExp(`-\\s*${k}\\s*[:：]\\s*(.+)`));
    return (m ? m[1].trim() : "") || PREF_OPTIONS[k][0];
  };
  return {
    图表类型: get("图表类型"),
    输出格式: get("输出格式"),
    语言: get("语言"),
  };
}

function parseNotes(content: string): string {
  const m = content.match(/##\s*备注\s*\n([\s\S]*)$/);
  if (!m) return "";
  const text = m[1].trim();
  return text === NOTES_PLACEHOLDER ? "" : text;
}

// 内容不符合模板时（被手动改过、或后端换了模板）降级为源码编辑，避免重建时丢内容
function looksLikeTemplate(content: string): boolean {
  return (
    /##\s*追踪主题/.test(content) &&
    /##\s*输出偏好/.test(content) &&
    /##\s*备注/.test(content)
  );
}

function buildProfileMd(topics: string[], prefs: Prefs, notes: string): string {
  const topicLines =
    topics.length > 0 ? topics.map((t) => `- ${t}`).join("\n") : TOPIC_PLACEHOLDER;
  const prefLines = PREF_KEYS.map(
    (k) => `- ${k}: ${prefs[k] || PREF_OPTIONS[k][0]}`
  ).join("\n");
  const notesBody = notes.trim() || NOTES_PLACEHOLDER;

  return [
    "# 用户画像",
    "<!-- 系统自动提炼 + 手动编辑。保存后下一个新会话生效。 -->",
    "",
    "## 追踪主题",
    topicLines,
    "",
    "## 输出偏好",
    prefLines,
    "",
    "## 备注",
    notesBody,
    "",
  ].join("\n");
}

export default function ProfileEditor({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [raw, setRaw] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [topicDraft, setTopicDraft] = useState("");
  const [prefs, setPrefs] = useState<Prefs>({
    图表类型: PREF_OPTIONS.图表类型[0],
    输出格式: PREF_OPTIONS.输出格式[0],
    语言: PREF_OPTIONS.语言[0],
  });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showRawPreview, setShowRawPreview] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaved(false);
    setShowRawPreview(false);
    getProfile(USER_ID)
      .then((p) => {
        const content = p.content ?? "";
        setRaw(content);
        if (looksLikeTemplate(content)) {
          setMode("form");
          setTopics(parseTopics(content));
          setPrefs(parsePrefs(content));
          setNotes(parseNotes(content));
        } else {
          setMode("raw");
        }
      })
      .catch(() => setLoadError("读取用户画像失败，请确认后端服务在运行。"))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const generated = useMemo(
    () => buildProfileMd(topics, prefs, notes),
    [topics, prefs, notes]
  );
  const payload = mode === "raw" ? raw : generated;
  // 渲染预览前剥掉 HTML 注释：react-markdown 默认不解析原始 HTML，会把
  // <!-- ... --> 当普通文字显示出来，观感跟"未渲染的模板"一样差。
  // 只影响预览，payload 里注释照旧保留。
  const previewMd = useMemo(
    () => payload.replace(/<!--[\s\S]*?-->\s*/g, ""),
    [payload]
  );

  const addTopic = () => {
    const v = topicDraft.trim();
    setTopicDraft("");
    if (!v) return;
    setTopics((prev) => (prev.includes(v) ? prev : [...prev, v]));
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await updateProfile(USER_ID, payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError("保存失败，画像未更新。请确认后端服务在运行。");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-[min(880px,94vw)] flex-col overflow-hidden rounded-2xl bg-surface-000 shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-line-200 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-900">用户画像</h2>
            <p className="mt-0.5 text-[12px] text-ink-500">
              系统会在新会话中据此调整追踪主题与输出口径
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ic-icon-btn shrink-0"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loadError && <ErrorNote message={loadError} />}
          {saveError && <ErrorNote message={saveError} />}

          {loading ? (
            <div className="space-y-3">
              {[80, 56, 64].map((w) => (
                <div
                  key={w}
                  className="h-9 animate-pulse rounded-[var(--radius-sm)] bg-surface-100"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          ) : mode === "raw" ? (
            <div className="space-y-3">
              <p className="text-[12.5px] leading-relaxed text-ink-500">
                当前画像不是标准模板（可能被手动改过），已切换为源码编辑：直接保存下面的内容，不做重建。
              </p>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                spellCheck={false}
                className="h-[46vh] w-full resize-none rounded-[var(--radius-sm)] border border-line-300 bg-surface-050 p-3 font-mono text-[12.5px] leading-6 text-ink-800 outline-none transition-colors focus:border-signal"
              />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-5">
                <Field
                  label="追踪主题"
                  hint="回车添加，点 × 删除；系统也会自动提炼"
                >
                  <div className="flex flex-wrap gap-1.5">
                    {topics.length === 0 ? (
                      <span className="text-[12.5px] text-ink-400">
                        尚未提炼，继续对话或手动添加
                      </span>
                    ) : (
                      topics.map((t) => (
                        <span key={t} className="ic-tag ic-tag-signal">
                          {t}
                          <button
                            type="button"
                            onClick={() =>
                              setTopics((prev) => prev.filter((x) => x !== t))
                            }
                            aria-label={`删除 ${t}`}
                            className="text-signal-lo/60 transition-colors hover:text-signal-lo"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={topicDraft}
                      onChange={(e) => setTopicDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTopic();
                        }
                      }}
                      placeholder="例如：Agent 框架"
                      className="ic-input"
                    />
                    <button
                      type="button"
                      onClick={addTopic}
                      disabled={!topicDraft.trim()}
                      className="ic-btn-ghost shrink-0"
                    >
                      <Plus size={13} />
                      添加
                    </button>
                  </div>
                </Field>

                <Field label="输出偏好">
                  <div className="space-y-2">
                    {PREF_KEYS.map((k) => (
                      <div key={k} className="flex items-center gap-3">
                        <span className="w-16 shrink-0 text-[12.5px] text-ink-500">
                          {k}
                        </span>
                        <select
                          value={prefs[k]}
                          onChange={(e) =>
                            setPrefs((p) => ({ ...p, [k]: e.target.value }))
                          }
                          className="ic-input"
                        >
                          {optionsFor(k, prefs[k]).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </Field>

                <Field label="备注" hint="自由补充，不会被自动提炼覆盖">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    placeholder="例如：图表优先保证可读性，来源链接尽量放正文里"
                    className="ic-input resize-y"
                  />
                </Field>
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink-700">
                    将保存的内容
                  </span>
                  <div className="flex items-center rounded-[var(--radius-xs)] bg-surface-100 p-0.5">
                    {(
                      [
                        [false, "预览"],
                        [true, "Markdown"],
                      ] as const
                    ).map(([isRaw, label]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setShowRawPreview(isRaw)}
                        className={`rounded-[var(--radius-xs)] px-2 py-0.5 text-[11px] transition-colors ${
                          showRawPreview === isRaw
                            ? "bg-surface-000 text-ink-800 shadow-[var(--shadow-xs)]"
                            : "text-ink-500 hover:text-ink-700"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ic-panel min-h-[240px] flex-1 overflow-y-auto p-3">
                  {showRawPreview ? (
                    <pre className="ic-data whitespace-pre-wrap border-0 bg-transparent p-0">
                      {payload}
                    </pre>
                  ) : (
                    <div className="markdown-body">
                      <MarkdownRenderer content={previewMd} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line-200 px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-400">
            保存后下一个新会话生效
          </span>
          {saved && (
            <span className="flex shrink-0 items-center gap-1 text-[12px] text-go">
              <Check size={13} />
              已保存
            </span>
          )}
          <button type="button" onClick={onClose} className="ic-btn-ghost shrink-0">
            关闭
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="ic-btn shrink-0"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 保留已存的值：若存量值不在预设项里（用户以前填过别的），把它作为额外选项挂上去，
// 否则 select 会因为没有匹配项而显示空白，保存时又被悄悄改成默认值。
function optionsFor(k: PrefKey, current: string): string[] {
  return PREF_OPTIONS[k].includes(current)
    ? PREF_OPTIONS[k]
    : [current, ...PREF_OPTIONS[k]];
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-ink-700">{label}</span>
        {hint && <span className="text-[11.5px] text-ink-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-[var(--radius-sm)] bg-stop-soft px-3 py-2 text-[12.5px] leading-relaxed text-stop">
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
    </div>
  );
}
