import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  Box,
  LayoutGrid,
  Menu,
  MessageSquare,
  Plus,
  Radio,
  Search,
  Settings,
  Sparkles,
  FolderOpen,
  FileCode2,
  ChevronRight,
  RefreshCw,
  Code2,
  Image as ImageIcon,
  BookOpen,
  Coffee,
  Sun,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  Pencil,
  X,
  Eye,
  FileText,
  Save,
  Loader2
} from "lucide-react";
import { ChatComposer } from "./components/ChatComposer";
import { BlockView } from "./components/BlockView";
import { SessionsPanel } from "./components/SessionsPanel";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { TitleBar } from "./components/TitleBar";
import { ContextMenu } from "./components/ContextMenu";
import { useDesktopBridge, createSessionAndLoad } from "./hooks/useDesktopBridge";
import { useChatStore } from "./store/chatStore";
import type { FileNode } from "./types";
import { codeToHtml } from "shiki";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function StreamingPanel({ content }: { content: string }) {
  if (!content) return null;
  return (
    <article className="message-card message-streaming">
      <div className="message-meta">
        <Radio size={14} />
        streaming
      </div>
      <div className="text-block mt-3 bg-transparent">{content}</div>
    </article>
  );
}

function SidebarWorkspaceNode({
  node,
  onOpen,
  level = 0
}: {
  node: FileNode;
  onOpen: (path: string) => void;
  level?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (node.is_dir) {
    return (
      <div className="flex flex-col w-full">
        <button
          className="flex items-center gap-1.5 py-1 hover:bg-[#EAEAEA] rounded-[6px] text-[13px] text-gray-700 transition-colors w-full text-left"
          style={{ paddingLeft: `${level * 10 + 6}px`, paddingRight: '6px' }}
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          <div className="flex-shrink-0 w-3.5 flex justify-center text-gray-400">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </div>
          <FolderOpen size={13} className="text-gray-400 flex-shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div className="flex flex-col w-full">
            {node.children.map((child) => (
              <SidebarWorkspaceNode key={child.path} node={child} onOpen={onOpen} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className="flex items-center gap-1.5 py-1 hover:bg-[#EAEAEA] rounded-[6px] text-[13px] text-gray-700 transition-colors w-full text-left"
      style={{ paddingLeft: `${level * 10 + 25}px`, paddingRight: '6px' }}
      onClick={() => onOpen(node.path)}
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", node.path);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <FileCode2 size={13} className="text-gray-400 flex-shrink-0" />
      <span className="truncate" title={node.path}>{node.name}</span>
    </button>
  );
}

export default function App() {
  useDesktopBridge();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const connection = useChatStore((state) => state.connection);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const messages = useChatStore((state) => state.messages);
  const sessions = useChatStore((state) => state.sessions);
  const workspace = useChatStore((state) => state.workspace);
  const tree = useChatStore((state) => state.tree);
  const streamingText = useChatStore((state) => state.streamingText);
  const previewPath = useChatStore((state) => state.previewPath);
  const previewContent = useChatStore((state) => state.previewContent);
  const setPreview = useChatStore((state) => state.setPreview);
  const appendSelectedFiles = useChatStore((state) => state.appendSelectedFiles);
  const setWorkspace = useChatStore((state) => state.setWorkspace);
  const setTree = useChatStore((state) => state.setTree);
  const activeSession = sessions.find((session) => session.id === activeSessionId);

  const [highlightedPreview, setHighlightedPreview] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!previewPath || !previewContent) {
      setHighlightedPreview("");
      return;
    }

    const ext = previewPath.split('.').pop()?.toLowerCase() || 'text';
    const langMap: Record<string, string> = {
      'rs': 'rust',
      'ts': 'typescript',
      'tsx': 'tsx',
      'js': 'javascript',
      'jsx': 'jsx',
      'md': 'markdown',
      'json': 'json',
      'toml': 'toml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'css': 'css',
      'html': 'html',
      'py': 'python',
      'sh': 'bash',
      'txt': 'text',
    };
    const lang = langMap[ext] || 'text';

    void codeToHtml(previewContent, {
      lang,
      theme: 'github-light'
    })
      .then((html) => {
        if (!cancelled) setHighlightedPreview(html);
      })
      .catch(() => {
        void codeToHtml(previewContent, { lang: 'text', theme: 'github-light' })
          .then((fallbackHtml) => { if (!cancelled) setHighlightedPreview(fallbackHtml); })
          .catch(() => { if (!cancelled) setHighlightedPreview(""); });
      });

    return () => { cancelled = true; };
  }, [previewPath, previewContent]);

  const [isProjectsExpanded, setIsProjectsExpanded] = useState(false);

  const refreshWorkspace = async () => {
    if (workspace) {
      const nodes = await invoke<FileNode[]>("read_workspace", { path: workspace });
      setTree(nodes);
    }
  };

  const toggleProjects = async () => {
    if (!isSidebarOpen) setIsSidebarOpen(true);
    if (!workspace) {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        const nodes = await invoke<FileNode[]>("read_workspace", { path: selected });
        await invoke("save_workspace", { path: selected });
        setWorkspace(selected);
        setTree(nodes);
        setIsProjectsExpanded(true);
      }
    } else {
      const willExpand = !isProjectsExpanded;
      setIsProjectsExpanded(willExpand);
      if (willExpand) await refreshWorkspace();
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const [previewWidth, setPreviewWidth] = useState(() => Math.round(window.innerWidth * 0.45));

  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isMarkdownPreviewMode, setIsMarkdownPreviewMode] = useState(true);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditContent(previewContent);
    setIsEditing(false);
    if (previewPath?.toLowerCase().endsWith(".md")) {
      setIsMarkdownPreviewMode(true);
    } else {
      setIsMarkdownPreviewMode(false);
    }
    if (!previewPath) {
      setIsChatCollapsed(false);
    }
  }, [previewContent, previewPath]);

  const handlePreviewFile = async (path: string) => {
    const content = await invoke<string>("read_file_content", { path });
    setPreview(path, content);
  };

  const handleSaveFile = async () => {
    if (!previewPath) return;
    setIsSaving(true);
    try {
      await invoke("write_file_content", { path: previewPath, content: editContent });
      setPreview(previewPath, editContent);
      setIsEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevealPath = async (path: string) => {
    await invoke("open_in_explorer", { path });
  };

  const formatShortTime = (createdAt: string) => {
    const date = new Date(createdAt);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  };

  const formatFullTime = (createdAt: string) => {
    const date = new Date(createdAt);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <main className="app-shell font-sans text-[#171717] bg-white h-screen overflow-hidden flex flex-col">
      <ContextMenu />
      <TitleBar
        isSidebarOpen={isSidebarOpen}
        toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        sidebarWidth={isSidebarOpen ? 260 : 64}
        connection={connection}
        previewPath={previewPath}
        isChatCollapsed={isChatCollapsed}
        toggleChat={() => setIsChatCollapsed(!isChatCollapsed)}
      />

      <div className="app-layout-claude flex w-full flex-1 relative overflow-hidden">

        {/* Sidebar */}
        <div className={`flex flex-shrink-0 transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-[260px]' : 'w-[64px]'} overflow-hidden h-full border-r border-[#E5E5E5] bg-[#F9F9F9] group/sidebar`}>
          <aside className="relative flex flex-col w-full h-full flex-shrink-0">
            <div className={`flex flex-col mb-4 p-2 gap-0.5 pt-3 ${isSidebarOpen ? '' : 'items-center'}`}>
              <button
                className={`flex items-center ${isSidebarOpen ? 'gap-2 px-2.5 justify-start' : 'justify-center w-10'} py-2 hover:bg-[#EAEAEA] rounded-[8px] text-[13.5px] font-medium transition-colors text-[#1A1A1A] h-[36px] min-w-0`}
                type="button"
                onClick={() => void createSessionAndLoad()}
                title="New chat"
              >
                <Plus size={isSidebarOpen ? 15 : 18} className="text-gray-500 flex-shrink-0" />
                {isSidebarOpen && <span className="truncate">New chat</span>}
              </button>
              <button
                className={`flex items-center ${isSidebarOpen ? 'gap-2 px-2.5 justify-start' : 'justify-center w-10'} py-2 hover:bg-[#EAEAEA] rounded-[8px] text-[13.5px] transition-colors text-[#1A1A1A] h-[36px] min-w-0`}
                type="button"
                title="Search"
                onClick={() => !isSidebarOpen && setIsSidebarOpen(true)}
              >
                <Search size={isSidebarOpen ? 15 : 18} className="text-gray-500 flex-shrink-0" />
                {isSidebarOpen && <span className="truncate">Search</span>}
              </button>
              <button
                className={`flex items-center ${isSidebarOpen ? 'gap-2 px-2.5 justify-start' : 'justify-center w-10'} py-2 hover:bg-[#EAEAEA] rounded-[8px] text-[13.5px] transition-colors text-[#1A1A1A] h-[36px] min-w-0`}
                type="button"
                title="Customize"
                onClick={() => !isSidebarOpen && setIsSidebarOpen(true)}
              >
                <Settings size={isSidebarOpen ? 15 : 18} className="text-gray-500 flex-shrink-0" />
                {isSidebarOpen && <span className="truncate">Customize</span>}
              </button>
            </div>

            <div className={`flex-1 overflow-y-auto px-2 no-scrollbar flex flex-col gap-1 w-full pb-4 ${isSidebarOpen ? '' : 'items-center overflow-x-hidden'}`}>
              <div className={`flex flex-col gap-0.5 mb-6 ${isSidebarOpen ? 'w-full' : 'items-center'}`}>
                <button
                  className={`flex items-center ${isSidebarOpen ? 'justify-between px-2.5' : 'justify-center w-10'} py-2 hover:bg-[#EAEAEA] rounded-[8px] text-[13.5px] transition-colors ${isSidebarOpen ? 'w-full bg-[#EAEAEA]/40' : ''} text-[#1A1A1A] h-[36px] min-w-0`}
                  title="Chats"
                  onClick={() => !isSidebarOpen && setIsSidebarOpen(true)}
                >
                  <div className={`flex items-center ${isSidebarOpen ? 'gap-2' : ''}`}>
                    <MessageSquare size={isSidebarOpen ? 15 : 18} className="text-gray-500 flex-shrink-0" />
                    {isSidebarOpen && <span>Chats</span>}
                  </div>
                </button>
                <div className="w-full flex flex-col group">
                  <div className="flex items-center w-full">
                    <button
                      className={`flex-1 flex items-center ${isSidebarOpen ? 'justify-between px-2.5' : 'justify-center w-10'} py-2 hover:bg-[#EAEAEA] rounded-[8px] text-[13.5px] transition-colors text-[#1A1A1A] h-[36px] min-w-0`}
                      title="Projects"
                      onClick={() => void toggleProjects()}
                    >
                      <div className={`flex items-center ${isSidebarOpen ? 'gap-2' : ''}`}>
                        <LayoutGrid size={isSidebarOpen ? 15 : 18} className="text-gray-500 flex-shrink-0" />
                        {isSidebarOpen && <span>Projects</span>}
                      </div>
                      {isSidebarOpen && !workspace && <Plus size={14} className="opacity-0 group-hover:opacity-100 text-gray-400 transition-opacity flex-shrink-0" />}
                    </button>
                    {isSidebarOpen && workspace && (
                      <button
                        className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-gray-600 hover:bg-[#EAEAEA] rounded-[6px] transition-all ml-1"
                        title="Refresh Workspace"
                        onClick={(e) => { e.stopPropagation(); void refreshWorkspace(); }}
                      >
                        <RefreshCw size={13} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                  {isSidebarOpen && isProjectsExpanded && tree.length > 0 && (
                    <div className="flex flex-col gap-0.5 mt-0.5 mb-2 w-full pr-1">
                      {tree.map(node => <SidebarWorkspaceNode key={node.path} node={node} onOpen={(path) => void handlePreviewFile(path)} />)}
                    </div>
                  )}
                </div>
                <button
                  className={`flex items-center ${isSidebarOpen ? 'gap-2 px-2.5 justify-start' : 'justify-center w-10'} py-2 hover:bg-[#EAEAEA] rounded-[8px] text-[13.5px] transition-colors text-[#1A1A1A] ${isSidebarOpen ? 'w-full' : ''} h-[36px] min-w-0`}
                  title="Artifacts"
                  onClick={() => !isSidebarOpen && setIsSidebarOpen(true)}
                >
                  <Box size={isSidebarOpen ? 15 : 18} className="text-gray-500 flex-shrink-0" />
                  {isSidebarOpen && <span>Artifacts</span>}
                </button>
                <button
                  className={`flex items-center ${isSidebarOpen ? 'gap-2 px-2.5 justify-start' : 'justify-center w-10'} py-2 hover:bg-[#EAEAEA] rounded-[8px] text-[13.5px] transition-colors text-[#1A1A1A] ${isSidebarOpen ? 'w-full' : ''} h-[36px] min-w-0`}
                  title="Code"
                  onClick={() => !isSidebarOpen && setIsSidebarOpen(true)}
                >
                  <Code2 size={isSidebarOpen ? 15 : 18} className="text-gray-500 flex-shrink-0" />
                  {isSidebarOpen && <span>Code</span>}
                </button>
              </div>

              {isSidebarOpen && (
                <div className="mb-2 w-full">
                  <div className="px-3 py-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-widest mb-1">
                    Recents
                  </div>
                  <SessionsPanel />
                </div>
              )}

              {isSidebarOpen && (
                <div className="mt-4 mb-2 opacity-30 pointer-events-none hidden w-full">
                  <div className="px-3 py-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-widest mb-1">
                    Workspace
                  </div>
                  <WorkspacePanel />
                </div>
              )}
            </div>

            <div className={`mt-auto border-t border-[#E5E5E5] bg-[#F9F9F9] ${isSidebarOpen ? 'p-2' : 'p-2 flex justify-center'}`}>
              <div
                className={`flex items-center ${isSidebarOpen ? 'gap-2.5 px-2 justify-between' : 'justify-center px-0 w-10'} py-2 hover:bg-[#EAEAEA] rounded-[8px] cursor-pointer transition-colors ${isSidebarOpen ? 'w-full' : ''}`}
                title="Profile & Settings"
              >
                <div className={`flex items-center ${isSidebarOpen ? 'gap-2.5 min-w-0' : 'justify-center'}`}>
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#3A352F] text-[#F8F6F2] flex items-center justify-center font-medium text-[12px]">
                    L
                  </div>
                  {isSidebarOpen && (
                    <div className="flex flex-col min-w-0">
                      <span className="text-[13.5px] font-medium leading-none text-[#1A1A1A] mb-1 truncate">lita</span>
                      <span className="text-[11.5px] text-gray-500 leading-none truncate">Free plan</span>
                    </div>
                  )}
                </div>
                {isSidebarOpen && (
                  <button className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded bg-white border border-[#E5E5E5] shadow-[0_1px_2px_rgba(0,0,0,0.05)] flex-shrink-0">
                    <ChevronDown size={12} />
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>

        {/* Main Chat Area */}
        <section className={`chat-stage bg-white flex-col relative h-full ${isChatCollapsed ? 'w-0 min-w-0 overflow-hidden opacity-0' : 'flex flex-1 min-w-[320px]'}`}>
          <div className="flex-1 overflow-y-auto no-scrollbar w-full flex flex-col relative items-center pt-16">
            <div className="w-full max-w-[48rem] px-4 flex flex-col min-h-full">
              {messages.length === 0 && !streamingText ? (
                <div className="flex flex-col items-center justify-center my-auto w-full h-full min-h-[50vh]">
                  <div className="flex items-center justify-center gap-3 text-[#D97757] w-full text-center">
                    <Sun size={36} className="text-[#D97757]" />
                    <h1 className="text-[36px] text-center text-[#1A1A1A] tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
                      Afternoon, lita
                    </h1>
                  </div>
                </div>
              ) : (
                <div className="w-full flex-1 mt-8 flex flex-col pb-8">
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={`group mb-6 flex flex-col ${message.role === "assistant" ? "w-full max-w-none" : "self-end max-w-[80%]"}`}
                    >
                      {message.role === "assistant" && (
                        <div className="message-meta mb-2 text-amber-700">
                          <Sparkles size={14} />
                          lita
                        </div>
                      )}

                      {message.text && (
                        <div className={`text-block text-[15px] leading-[1.65] text-[#1A1A1A] ${message.role === "assistant" ? "" : "bg-[#F3F3F3] px-4 py-3 rounded-2xl"}`}>
                          {message.text}
                        </div>
                      )}

                      {message.files && message.files.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {message.files.map((file) => (
                            <span key={file} className="file-chip bg-gray-50 border-gray-200 text-gray-600">
                              {file}
                            </span>
                          ))}
                        </div>
                      )}

                      {message.blocks && message.blocks.length > 0 && (
                        <div className="mt-4 space-y-3">
                          {message.blocks.map((block, index) => (
                            <BlockView
                              key={`${message.id}-${block.type}-${index}`}
                              block={block}
                              onPreviewFile={(path) => void handlePreviewFile(path)}
                              onAttachFile={(path) => appendSelectedFiles([path])}
                              onRevealPath={(path) => void handleRevealPath(path)}
                            />
                          ))}
                        </div>
                      )}

                      {message.role === "assistant" && (
                        <div className="mt-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <button className="flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Copy">
                            <Copy size={15} strokeWidth={1.5} />
                          </button>
                          <button className="flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Good response">
                            <ThumbsUp size={15} strokeWidth={1.5} />
                          </button>
                          <button className="flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Bad response">
                            <ThumbsDown size={15} strokeWidth={1.5} />
                          </button>
                          <button className="flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Retry">
                            <RotateCcw size={15} strokeWidth={1.5} />
                          </button>
                        </div>
                      )}

                      {message.role === "user" && (
                        <div className="mt-2 flex items-center gap-1.5 px-1 self-end opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          {message.createdAt && (
                            <span
                              className="text-[11.5px] text-gray-400 mr-1 cursor-default"
                              title={formatFullTime(message.createdAt)}
                            >
                              {formatShortTime(message.createdAt)}
                            </span>
                          )}
                          <button className="flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Retry">
                            <RotateCcw size={14} strokeWidth={1.5} />
                          </button>
                          <button className="flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Edit">
                            <Pencil size={14} strokeWidth={1.5} />
                          </button>
                          <button className="flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Copy">
                            <Copy size={14} strokeWidth={1.5} />
                          </button>
                        </div>
                      )}
                    </article>
                  ))}

                  {streamingText && <StreamingPanel content={streamingText} />}

                  <div className="h-48 flex-shrink-0 w-full" />
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
          </div>

          {/* Floating input */}
          <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center pointer-events-none z-20">
            <div className="w-full max-w-[48rem] px-4 pointer-events-auto">
              <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] border border-[#E5E5E5] overflow-hidden w-full">
                <ChatComposer />
              </div>
              {messages.length === 0 && !streamingText && (
                <div className="flex justify-center gap-2 mt-4 text-gray-600 flex-wrap">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E5E5E5] bg-white rounded-full text-[13px] font-medium hover:bg-gray-50 transition-colors shadow-sm"><Code2 size={14} /> Code</button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E5E5E5] bg-white rounded-full text-[13px] font-medium hover:bg-gray-50 transition-colors shadow-sm"><BookOpen size={14} /> Learn</button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E5E5E5] bg-white rounded-full text-[13px] font-medium hover:bg-gray-50 transition-colors shadow-sm"><ImageIcon size={14} /> Create</button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E5E5E5] bg-white rounded-full text-[13px] font-medium hover:bg-gray-50 transition-colors shadow-sm"><Sparkles size={14} /> Write</button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E5E5E5] bg-white rounded-full text-[13px] font-medium hover:bg-gray-50 transition-colors shadow-sm"><Coffee size={14} /> Life stuff</button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Resizable Divider — hidden when chat is collapsed */}
        {previewPath && !isChatCollapsed && (
          <div
            className="group relative flex w-[1px] cursor-col-resize flex-col items-center justify-center bg-[#E5E5E5] z-30 flex-shrink-0"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = previewWidth;
              document.body.style.userSelect = "none";

              const handleMouseMove = (moveEvent: MouseEvent) => {
                const sidebarW = isSidebarOpen ? 260 : 64;
                const minPreview = Math.round(window.innerWidth * 0.20);
                const maxPreview = Math.max(minPreview, window.innerWidth - sidebarW - 320 - 10);
                const newWidth = Math.max(minPreview, Math.min(maxPreview, startWidth - (moveEvent.clientX - startX)));
                setPreviewWidth(newWidth);
              };

              const handleMouseUp = () => {
                document.body.style.userSelect = "";
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
              };

              document.addEventListener("mousemove", handleMouseMove);
              document.addEventListener("mouseup", handleMouseUp);
            }}
          >
            <div className="absolute -left-2 -right-2 top-0 bottom-0 z-10 cursor-col-resize" />
            <div className="absolute z-20 h-7 w-[5px] rounded-full border border-[#D4D4D4] bg-white shadow-sm transition-colors group-hover:border-[#A3A3A3] group-hover:bg-[#F9F9F9] group-active:bg-[#F0F0F0] pointer-events-none" />
          </div>
        )}

        {/* File Preview Pane */}
        <div
          className={`flex flex-col flex-shrink min-w-[200px] transition-opacity duration-300 ease-in-out bg-white h-full relative overflow-hidden ${previewPath ? "opacity-100" : "opacity-0 w-[0!important] min-w-[0!important]"}`}
          style={previewPath ? { width: isChatCollapsed ? '100%' : `${previewWidth}px`, maxWidth: isChatCollapsed ? '100%' : `calc(100vw - ${isSidebarOpen ? 260 : 64}px - 320px - 1px)` } : {}}
        >
          {previewPath && (
            <>
              <div className="flex-shrink-0 flex items-center justify-between h-[52px] px-3 border-b border-[#E5E5E5] bg-white">
                <div className="flex items-center gap-2 overflow-hidden px-1">
                  <span className="font-medium text-[13.5px] truncate max-w-[180px] text-[#1a1a1a]" title={previewPath}>
                    {previewPath.split(/[/\\]/).pop()?.split('.').slice(0, -1).join('.') || previewPath.split(/[/\\]/).pop()}
                  </span>
                  {previewPath.includes('.') && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span className="font-medium text-[12px] text-gray-500 uppercase tracking-wider">
                        {previewPath.split('.').pop()}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <button
                        className="flex items-center justify-center p-1.5 text-[#1a1a1a] border border-[#e5e5e5] hover:bg-gray-50 rounded-[6px] transition-colors shadow-sm bg-white"
                        onClick={() => {
                          setIsEditing(false);
                          setEditContent(previewContent);
                        }}
                        title="Cancel"
                      >
                        <X size={15} />
                      </button>
                      <button
                        className="flex items-center justify-center p-1.5 text-white bg-[#D97A5B] hover:bg-[#c2694b] border border-[#c2694b] rounded-[6px] transition-colors shadow-sm disabled:opacity-50"
                        onClick={() => void handleSaveFile()}
                        disabled={isSaving}
                        title="Save Changes"
                      >
                        {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="flex items-center justify-center p-1.5 text-[#1a1a1a] border border-[#e5e5e5] hover:bg-gray-50 rounded-[6px] transition-colors shadow-sm bg-white"
                        onClick={async () => { await navigator.clipboard.writeText(previewContent); }}
                        title="Copy All"
                      >
                        <Copy size={14} className="text-gray-500" />
                      </button>
                      <button
                        className="flex items-center justify-center p-1.5 text-[#1a1a1a] border border-[#e5e5e5] hover:bg-gray-50 rounded-[6px] transition-colors shadow-sm bg-white"
                        onClick={() => setIsEditing(true)}
                        title="Edit File"
                      >
                        <Pencil size={14} className="text-gray-500" />
                      </button>

                      {previewPath.toLowerCase().endsWith(".md") && (
                        <button
                          className={`flex items-center justify-center p-1.5 border rounded-[6px] transition-colors shadow-sm ${isMarkdownPreviewMode
                            ? "bg-amber-50 border-amber-200 text-amber-600 font-medium"
                            : "bg-white border-[#e5e5e5] text-gray-500 hover:bg-gray-50"
                            }`}
                          onClick={() => setIsMarkdownPreviewMode(!isMarkdownPreviewMode)}
                          title={isMarkdownPreviewMode ? "Source View" : "Render View"}
                        >
                          {isMarkdownPreviewMode ? <FileText size={14} /> : <Eye size={14} />}
                        </button>
                      )}
                    </>
                  )}
                  <div className="w-[1px] h-4 bg-gray-200 mx-1.5" />
                  <button className="p-1.5 text-gray-500 hover:text-[#1a1a1a] hover:bg-gray-100 rounded-[6px] transition-colors" title="Reload" onClick={() => void handlePreviewFile(previewPath)}>
                    <RotateCcw size={15} />
                  </button>
                  <button
                    className="p-1.5 text-gray-500 hover:text-[#1a1a1a] hover:bg-gray-100 rounded-[6px] transition-colors"
                    onClick={() => setPreview("", "")}
                    title="Close"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto preview-content bg-white relative">
                {isEditing ? (
                  <textarea
                    className="w-full h-full resize-none p-6 outline-none font-mono text-[13px] leading-relaxed text-gray-800 bg-transparent"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    spellCheck="false"
                  />
                ) : isMarkdownPreviewMode && previewPath.toLowerCase().endsWith(".md") ? (
                  <div className="p-8 prose prose-slate max-w-none prose-sm prose-headings:font-medium prose-headings:text-[#1a1a1a] prose-p:text-[#333] prose-strong:text-[#1a1a1a] prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {previewContent || ""}
                    </ReactMarkdown>
                  </div>
                ) : highlightedPreview ? (
                  <div
                    className="shiki-preview w-full h-full text-[13px] font-mono leading-relaxed text-gray-800 break-words"
                    dangerouslySetInnerHTML={{ __html: highlightedPreview }}
                  />
                ) : (
                  <pre className="text-[13px] font-mono whitespace-pre-wrap leading-relaxed text-gray-800 break-words p-6">
                    {previewContent || "Loading..."}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
