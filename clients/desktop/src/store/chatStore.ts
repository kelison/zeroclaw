import { create } from "zustand";
import type {
  Block,
  ChatMessage,
  ConnectionEvent,
  FileNode,
  SessionSummary,
  SocketEnvelope
} from "../types";

interface ChatState {
  connection: ConnectionEvent;
  sessions: SessionSummary[];
  activeSessionId: string;
  messages: ChatMessage[];
  streamingText: string;
  streamingSessionId: string;
  workspace: string;
  tree: FileNode[];
  previewPath: string;
  previewContent: string;
  selectedFiles: string[];
  pendingPaste: string;
  setSessions: (sessions: SessionSummary[]) => void;
  setActiveSession: (sessionId: string) => void;
  setWorkspace: (workspace: string) => void;
  setTree: (tree: FileNode[]) => void;
  setPreview: (path: string, content: string) => void;
  setSelectedFiles: (files: string[]) => void;
  appendSelectedFiles: (files: string[]) => void;
  pushUserMessage: (text: string, files: string[]) => void;
  setConnection: (connection: ConnectionEvent) => void;
  ingestEnvelope: (envelope: SocketEnvelope) => void;
  hydrateHistory: (messages: ChatMessage[]) => void;
  setPendingPaste: (text: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  connection: { status: "waiting", detail: "Waiting for ZeroClaw to start..." },
  sessions: [],
  activeSessionId: "",
  messages: [],
  streamingText: "",
  streamingSessionId: "",
  workspace: "",
  tree: [],
  previewPath: "",
  previewContent: "",
  selectedFiles: [],
  pendingPaste: "",
  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (activeSessionId) =>
    set({ activeSessionId, messages: [], streamingText: "", streamingSessionId: "" }),
  setWorkspace: (workspace) => set({ workspace }),
  setTree: (tree) => set({ tree }),
  setPreview: (previewPath, previewContent) => set({ previewPath, previewContent }),
  setSelectedFiles: (selectedFiles) => set({ selectedFiles }),
  appendSelectedFiles: (files) =>
    set((state) => ({
      selectedFiles: Array.from(new Set(state.selectedFiles.concat(files.filter(Boolean))))
    })),
  pushUserMessage: (text, files) =>
    set((state) => ({
      messages: state.messages.concat({
        id: crypto.randomUUID(),
        role: "user",
        text,
        files,
        createdAt: new Date().toISOString()
      }),
      streamingText: "",
      streamingSessionId: state.activeSessionId
    })),
  setConnection: (connection) => set({ connection }),
  hydrateHistory: (messages) => set({ messages, streamingText: "", streamingSessionId: "" }),
  setPendingPaste: (text) => set({ pendingPaste: text }),
  ingestEnvelope: (envelope) =>
    set((state) => {
      if (envelope.type === "stream_chunk") {
        if (state.streamingSessionId && state.streamingSessionId !== state.activeSessionId) {
          return state;
        }
        return { streamingText: envelope.content ?? "" };
      }

      if (envelope.type === "stream_end") {
        if (state.streamingSessionId && state.streamingSessionId !== state.activeSessionId) {
          return { streamingText: "", streamingSessionId: "" };
        }
        return {
          streamingText: "",
          streamingSessionId: "",
          messages: state.messages.concat({
            id: crypto.randomUUID(),
            role: "assistant",
            blocks: envelope.blocks ?? [],
            createdAt: new Date().toISOString()
          })
        };
      }

      if (envelope.type === "text") {
        const content = envelope.content ?? "";
        if (state.streamingSessionId && state.streamingSessionId !== state.activeSessionId) {
          return { streamingText: "", streamingSessionId: "" };
        }
        return {
          streamingText: "",
          streamingSessionId: "",
          messages: state.messages.concat({
            id: crypto.randomUUID(),
            role: "assistant",
            text: content,
            createdAt: new Date().toISOString()
          })
        };
      }

      return state;
    })
}));