import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Pencil, Trash2 } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import type { ChatMessage, SessionBootstrap, SessionSummary } from "../types";

// ─── Custom Confirm Modal ───────────────────────────────────────────────────
function ConfirmModal({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.10)] border border-[#E5E5E5] w-[300px] p-5 flex flex-col gap-5">
        <p className="text-[13.5px] text-[#1A1A1A] leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-[8px] text-[13px] text-[#1A1A1A] bg-[#F3F3F3] hover:bg-[#EAEAEA] transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-3.5 py-1.5 rounded-[8px] text-[13px] text-white bg-[#D97757] hover:bg-[#C8673F] transition-colors"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Custom Prompt Modal ────────────────────────────────────────────────────
function PromptModal({
  label,
  defaultValue,
  onConfirm,
  onCancel,
}: {
  label: string;
  defaultValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.10)] border border-[#E5E5E5] w-[300px] p-5 flex flex-col gap-4">
        <p className="text-[13px] font-medium text-[#1A1A1A]">{label}</p>
        <input
          autoFocus
          className="w-full px-3 py-2 rounded-[8px] border border-[#E5E5E5] text-[13.5px] text-[#1A1A1A] outline-none focus:border-[#D97757] transition-colors bg-[#FAFAFA]"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm(value);
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-[8px] text-[13px] text-[#1A1A1A] bg-[#F3F3F3] hover:bg-[#EAEAEA] transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(value)}
            className="px-3.5 py-1.5 rounded-[8px] text-[13px] text-white bg-[#D97757] hover:bg-[#C8673F] transition-colors"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SessionsPanel ──────────────────────────────────────────────────────────
export function SessionsPanel() {
  const [query, setQuery] = useState("");
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const setSessions = useChatStore((state) => state.setSessions);
  const setActiveSession = useChatStore((state) => state.setActiveSession);
  const hydrateHistory = useChatStore((state) => state.hydrateHistory);

  const [confirmTarget, setConfirmTarget] = useState<SessionSummary | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);

  const loadSession = async (sessionId: string) => {
    setActiveSession(sessionId);
    await invoke("save_active_session", { sessionId });
    const messages = await invoke<ChatMessage[]>("load_history", { sessionId, limit: 48 });
    hydrateHistory(messages);
  };

  const renameSession = async (nextTitle: string) => {
    if (!renameTarget) return;
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === renameTarget.title) {
      setRenameTarget(null);
      return;
    }
    const updated = await invoke<SessionSummary>("rename_session", {
      sessionId: renameTarget.id,
      title: trimmed,
    });
    setSessions(sessions.map((item) => (item.id === updated.id ? updated : item)));
    setRenameTarget(null);
  };

  const deleteSession = async () => {
    if (!confirmTarget) return;
    const bootstrap = await invoke<SessionBootstrap>("delete_session", {
      sessionId: confirmTarget.id,
    });
    setSessions(bootstrap.sessions);
    await loadSession(bootstrap.activeSessionId);
    setConfirmTarget(null);
  };

  const filteredSessions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return sessions;
    return sessions.filter((session) => {
      const haystack = [session.title, session.preview ?? ""].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [query, sessions]);

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {filteredSessions.map((session) => (
          <div
            key={session.id}
            className={`group flex items-center gap-2 px-2 py-[7px] rounded-lg cursor-pointer transition-colors w-full ${session.id === activeSessionId ? "bg-[#EAEAEA]" : "hover:bg-[#EAEAEA]"
              }`}
            onClick={() => void loadSession(session.id)}
          >
            <div className="flex-1 min-w-0 pr-2">
              <div className="text-[13.5px] text-[#242424] truncate w-full leading-tight">
                {session.title}
              </div>
            </div>
            <div className="opacity-0 group-hover:opacity-100 flex items-center flex-shrink-0 transition-opacity">
              <button
                onClick={(e) => { e.stopPropagation(); setRenameTarget(session); }}
                className="p-1 hover:bg-[#D4D4D4] rounded text-gray-500 transition-colors"
                title="Rename"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmTarget(session); }}
                className="p-1 hover:bg-[#D4D4D4] rounded text-gray-500 transition-colors"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}

        {filteredSessions.length === 0 && (
          <div className="px-2 py-3 text-[13px] text-gray-500">No recent chats</div>
        )}
      </div>

      {confirmTarget && (
        <ConfirmModal
          message={`删除「${confirmTarget.title}」及其所有消息？`}
          onConfirm={() => void deleteSession()}
          onCancel={() => setConfirmTarget(null)}
        />
      )}

      {renameTarget && (
        <PromptModal
          label="重命名会话"
          defaultValue={renameTarget.title}
          onConfirm={(val) => void renameSession(val)}
          onCancel={() => setRenameTarget(null)}
        />
      )}
    </>
  );
}
