"use client";

import { Plus } from "lucide-react";

interface Props {
  onClick: () => void;
}

export default function NewChatButton({ onClick }: Props) {
  return (
    <div className="px-3 pb-2">
      <button onClick={onClick} className="ic-btn w-full">
        <Plus size={14} />
        新建对话
      </button>
    </div>
  );
}
