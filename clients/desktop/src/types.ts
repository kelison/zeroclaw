export type Block =
  | { type: "text"; content: string }
  | { type: "code"; lang?: string; content: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "image"; path: string }
  | { type: "file"; path: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  files?: string[];
  blocks?: Block[];
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  preview?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface ConnectionEvent {
  status: "waiting" | "connected" | "disconnected";
  detail: string;
}

export interface SocketEnvelope {
  type: "stream_chunk" | "stream_end" | "text" | "notify";
  content?: string;
  blocks?: Block[];
}

export interface WorkspaceState {
  workspace?: string;
  tree: FileNode[];
}

export interface SessionBootstrap {
  sessions: SessionSummary[];
  activeSessionId: string;
}
