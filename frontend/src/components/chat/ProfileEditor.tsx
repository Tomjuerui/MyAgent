"use client";

import { useEffect, useState } from "react";
import { getProfile, updateProfile } from "@/lib/api";

const USER_ID = "user-001";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ProfileEditor({ open, onClose }: Props) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedTip, setSavedTip] = useState(false);

  useEffect(() => {
    if (!open) return;
    getProfile(USER_ID)
      .then((p) => setContent(p.content))
      .catch(() => setContent(""));
  }, [open]);

  if (!open) return null;

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile(USER_ID, content);
      setSavedTip(true);
      setTimeout(() => setSavedTip(false), 2000);
    } catch {
      /* 保存失败静默，保留编辑内容 */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[min(640px,90vw)] rounded-xl bg-surface-000 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-ink-900">编辑用户画像</h2>
          <button className="ic-btn-ghost px-2 py-1" onClick={onClose}>
            关闭
          </button>
        </div>
        <p className="mt-1 text-[12px] text-ink-500">保存后下一个新会话生效。</p>
        <textarea
          className="mt-3 h-[50vh] w-full resize-none rounded-lg border border-line-200 bg-surface-050 p-3 font-mono text-[13px] text-ink-900 outline-none"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          {savedTip && <span className="ic-metric text-[12px]">已保存</span>}
          <button
            className="ic-btn px-3 py-1.5 text-[13px]"
            onClick={save}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
