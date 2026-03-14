import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, X, ArrowUp, FileCode2, Zap, ChevronRight } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import type { SessionBootstrap } from "../types";

function dedupeFiles(files: string[]) {
  return Array.from(new Set(files.filter(Boolean)));
}

// ─── Prompt 数据 ────────────────────────────────────────────────────────────

const PROMPT_CATEGORIES = [
  {
    id: "code",
    label: "代码",
    icon: "</>",
    color: "#D9A391",
    prompts: [
      "解释这段代码的逻辑和实现思路",
      "帮我进行代码审查并给出优化建议",
      "分析项目中存在的技术债务",
      "设计合理的数据结构来解决这个问题",
      "为以下代码生成单元测试用例",
      "将这段代码重构得更简洁易读",
    ],
  },
  {
    id: "write",
    label: "写作",
    icon: "✍",
    color: "#8FAF8F",
    prompts: [
      "润色并改进这段文字，使其更流畅",
      "将以下内容改写为正式的商务风格",
      "帮我写一封简洁专业的邮件",
      "为以下主题生成结构清晰的文章大纲",
      "提炼以下内容的核心要点",
      "将这段中文翻译成地道的英文",
    ],
  },
  {
    id: "analyze",
    label: "分析",
    icon: "◈",
    color: "#9DA8CA",
    prompts: [
      "对比分析这几个方案的优劣势",
      "识别以下数据中存在的规律和趋势",
      "评估这个方案的可行性与风险",
      "进行 SWOT 分析并给出建议",
      "帮我分析用户需求和痛点",
      "从多个维度拆解这个问题",
    ],
  },
  {
    id: "create",
    label: "创意",
    icon: "✦",
    color: "#C4A882",
    prompts: [
      "围绕这个主题头脑风暴 10 个创意",
      "为这个产品设计几个有记忆点的名字",
      "创作引人注目的标题和 Slogan",
      "设计用户体验流程和交互路径",
      "帮我生成有吸引力的营销文案",
      "提供一个创新的解决思路",
    ],
  },
] as const;

// ─── PromptPanel 组件（Portal 版，避免被父容器裁剪）───────────────────────────

function PromptPanel({
  anchorRef,
  onSelect,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onSelect: (prompt: string) => void;
  onClose: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState<string>(
    PROMPT_CATEGORIES[0].id
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const current = PROMPT_CATEGORIES.find((c) => c.id === activeCategory)!;

  // 计算面板位置：锚点按钮上方
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const panelH = 300; // 预估面板高度
      const panelW = 420;
      const top = rect.top - panelH - 8;   // 按钮上方 8px
      const left = Math.max(8, rect.left); // 不超出左边界
      // 超出右边界时左移
      const safeLeft = left + panelW > window.innerWidth - 8
        ? window.innerWidth - panelW - 8
        : left;
      setPos({ top, left: safeLeft });
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchorRef]);

  // 点击面板外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        anchorRef.current && !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose, anchorRef]);

  if (!pos) return null;

  return createPortal(
    <>
      <style>{`
        @keyframes promptPanelIn {
          from { opacity: 0; transform: translateY(6px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: 420,
          zIndex: 9999,
          animation: "promptPanelIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        className="bg-white rounded-2xl shadow-2xl border border-[#F0EDE8] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#F5F2EE]">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-[#D9A391]" strokeWidth={2.5} />
            <span className="text-[13px] font-semibold text-[#1A1A1A]">
              常用 Prompts
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex">
          {/* 左侧分类 */}
          <div className="w-[110px] flex-shrink-0 border-r border-[#F5F2EE] py-2">
            {PROMPT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors"
                style={{
                  background:
                    activeCategory === cat.id ? cat.color + "18" : "transparent",
                  borderRight:
                    activeCategory === cat.id
                      ? `2px solid ${cat.color}`
                      : "2px solid transparent",
                }}
              >
                <span
                  className="w-5 text-center leading-none"
                  style={{
                    fontFamily: "monospace",
                    color: activeCategory === cat.id ? cat.color : "#9CA3AF",
                    fontSize: cat.id === "code" ? "11px" : "15px",
                    fontWeight: cat.id === "code" ? 700 : 400,
                  }}
                >
                  {cat.icon}
                </span>
                <span
                  className="text-[13px] font-medium"
                  style={{
                    color: activeCategory === cat.id ? "#1A1A1A" : "#9CA3AF",
                  }}
                >
                  {cat.label}
                </span>
              </button>
            ))}
          </div>

          {/* 右侧 Prompt 列表 */}
          <div className="flex-1 py-2 overflow-y-auto max-h-[240px]">
            {current.prompts.map((prompt, i) => (
              <button
                key={i}
                onClick={() => {
                  onSelect(prompt);
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left group hover:bg-[#FAF8F6] transition-colors"
              >
                <ChevronRight
                  size={12}
                  className="flex-shrink-0 text-gray-300 group-hover:text-[#D9A391] transition-colors"
                  strokeWidth={2.5}
                />
                <span className="text-[13px] text-[#444] group-hover:text-[#1A1A1A] leading-snug transition-colors">
                  {prompt}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

// ─── ChatComposer 主组件 ─────────────────────────────────────────────────────

export function ChatComposer() {
  const [text, setText] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const zapBtnRef = useRef<HTMLButtonElement>(null);

  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const setSessions = useChatStore((state) => state.setSessions);
  const selectedFiles = useChatStore((state) => state.selectedFiles);
  const setSelectedFiles = useChatStore((state) => state.setSelectedFiles);
  const pushUserMessage = useChatStore((state) => state.pushUserMessage);
  const pendingPaste = useChatStore((state) => state.pendingPaste);
  const setPendingPaste = useChatStore((state) => state.setPendingPaste);

  // 消费 pendingPaste
  useEffect(() => {
    if (!pendingPaste) return;
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + pendingPaste + text.slice(end);
    setText(newText);

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const cursor = start + pendingPaste.length;
        textareaRef.current.selectionStart = cursor;
        textareaRef.current.selectionEnd = cursor;
        textareaRef.current.focus();
      }
    });

    setPendingPaste("");
  }, [pendingPaste]);

  const appendFiles = (files: string[]) => {
    setSelectedFiles(dedupeFiles(selectedFiles.concat(files)));
  };

  const pickFiles = async () => {
    const selected = await open({ directory: false, multiple: true });
    if (Array.isArray(selected)) {
      appendFiles(
        selected.filter((item): item is string => typeof item === "string")
      );
    } else if (typeof selected === "string") {
      appendFiles([selected]);
    }
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed && selectedFiles.length === 0) return;
    if (!activeSessionId) return;

    await invoke("send_message", {
      sessionId: activeSessionId,
      text: trimmed,
      files: selectedFiles,
    });
    pushUserMessage(trimmed, selectedFiles);
    const bootstrap = await invoke<SessionBootstrap>("load_sessions");
    setSessions(bootstrap.sessions);
    setText("");
    setSelectedFiles([]);
  };

  /** 选中 Prompt 后在光标处插入，若无光标则追加到末尾 */
  const handlePromptSelect = (prompt: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + prompt + text.slice(end);
    const newCursor = start + prompt.length;
    setText(newText);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const ta = textareaRef.current;
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
      ta.focus();
      ta.selectionStart = newCursor;
      ta.selectionEnd = newCursor;
    });
  };

  return (
    <div className="w-full bg-transparent p-3">
      {selectedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 w-full">
          {selectedFiles.map((file) => (
            <span
              key={file}
              className="flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E5E5E5] shadow-sm rounded-xl text-[13px] text-gray-700 select-none"
            >
              <FileCode2 size={15} className="text-gray-400 flex-shrink-0" />
              <span
                className="font-medium truncate max-w-[150px]"
                title={file}
              >
                {file.split(/[\\/]/).pop() || file}
              </span>
              <button
                className="p-1 -mr-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                type="button"
                onClick={() =>
                  setSelectedFiles(selectedFiles.filter((item) => item !== file))
                }
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col bg-white rounded-xl">
        {/* 文本输入区 */}
        <div
          className={`relative border-none bg-transparent transition-colors ${isDragActive ? "bg-orange-50/50" : ""
            }`}
          onDragEnter={(e) => {
            e.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            if (e.currentTarget === e.target) setIsDragActive(false);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setIsDragActive(true);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const rawPath = e.dataTransfer.getData("text/plain").trim();
            if (rawPath) appendFiles([rawPath]);
            setIsDragActive(false);
          }}
        >
          <textarea
            ref={(el) => {
              (
                textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>
              ).current = el;
              if (el) {
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
            className="w-full min-h-[50px] max-h-[200px] resize-none border-0 outline-none bg-transparent px-4 py-3 text-[15px] text-[#1A1A1A] placeholder:text-gray-400 leading-relaxed custom-scrollbar"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="How can I help you today?"
            rows={1}
          />
        </div>

        {/* 底部工具栏 */}
        <div className="flex justify-between items-center px-3 pt-1 pb-2">
          <div className="flex items-center gap-1 relative">
            {/* 附件按钮 */}
            <button
              className="flex items-center justify-center w-8 h-8 rounded-full text-gray-500 hover:bg-gray-100 transition-colors"
              onClick={() => void pickFiles()}
              type="button"
              title="附加文件"
            >
              <Plus size={18} strokeWidth={2} />
            </button>

            {/* ⚡ 常用 Prompt 按钮 */}
            <button
              ref={zapBtnRef}
              className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${showPrompts
                ? "bg-[#D9A391]/15 text-[#D9A391]"
                : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                }`}
              onClick={() => setShowPrompts((v) => !v)}
              type="button"
              title="常用 Prompts"
            >
              <Zap size={16} strokeWidth={2} />
            </button>

            {/* Prompt 面板（Portal 渲染，不受父容器裁剪） */}
            {showPrompts && (
              <PromptPanel
                anchorRef={zapBtnRef}
                onSelect={handlePromptSelect}
                onClose={() => setShowPrompts(false)}
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              className={`flex items-center justify-center w-8 h-8 rounded-[10px] transition-colors ${text.trim() || selectedFiles.length > 0
                ? "bg-[#D9A391] text-white hover:bg-[#C28C7B]"
                : "bg-[#D9A391]/50 text-white cursor-not-allowed"
                }`}
              onClick={() => void submit()}
              type="button"
              disabled={!text.trim() && selectedFiles.length === 0}
            >
              <ArrowUp size={17} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
