import { useEffect } from "react";
import { invoke, type PluginListener } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  onAction,
  registerActionTypes,
  requestPermission,
  sendNotification
} from "@tauri-apps/plugin-notification";
import { useChatStore } from "../store/chatStore";
import type {
  ChatMessage,
  ConnectionEvent,
  SessionBootstrap,
  SessionSummary,
  SocketEnvelope,
  WorkspaceState
} from "../types";

const NOTIFICATION_ACTION_TYPE = "zeroclaw-open";
const NOTIFICATION_ACTION_ID = "open-main-window";

export async function loadSessionById(sessionId: string) {
  useChatStore.getState().setActiveSession(sessionId);
  await invoke("save_active_session", { sessionId });
  const messages = await invoke<ChatMessage[]>("load_history", { sessionId, limit: 48 });
  useChatStore.getState().hydrateHistory(messages);
}

export async function createSessionAndLoad() {
  const session = await invoke<SessionSummary>("create_session");
  const currentSessions = useChatStore.getState().sessions;
  useChatStore.getState().setSessions([session].concat(currentSessions));
  await loadSessionById(session.id);
}

async function notify(content: string) {
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }

  if (granted) {
    sendNotification({
      title: "ZeroClaw",
      body: content,
      actionTypeId: NOTIFICATION_ACTION_TYPE,
      autoCancel: true
    });
  }
}

export function useDesktopBridge() {
  const hydrateHistory = useChatStore((state) => state.hydrateHistory);
  const setSessions = useChatStore((state) => state.setSessions);
  const setActiveSession = useChatStore((state) => state.setActiveSession);
  const setConnection = useChatStore((state) => state.setConnection);
  const ingestEnvelope = useChatStore((state) => state.ingestEnvelope);
  const setWorkspace = useChatStore((state) => state.setWorkspace);
  const setTree = useChatStore((state) => state.setTree);

  useEffect(() => {
    void registerActionTypes([
      {
        id: NOTIFICATION_ACTION_TYPE,
        actions: [
          {
            id: NOTIFICATION_ACTION_ID,
            title: "Open",
            foreground: true
          }
        ]
      }
    ]).catch(() => undefined);

    void invoke<SessionBootstrap>("load_sessions")
      .then(async (bootstrap) => {
        setSessions(bootstrap.sessions);
        setActiveSession(bootstrap.activeSessionId);
        const messages = await invoke<ChatMessage[]>("load_history", {
          sessionId: bootstrap.activeSessionId,
          limit: 48
        });
        hydrateHistory(messages);
      })
      .catch(() => undefined);

    void invoke<WorkspaceState>("load_workspace_state")
      .then((workspaceState) => {
        setWorkspace(workspaceState.workspace ?? "");
        setTree(workspaceState.tree);
      })
      .catch(() => undefined);

    let disposed = false;
    let unlistenConnection: (() => void) | undefined;
    let unlistenSocket: (() => void) | undefined;
    let unlistenTrayNewSession: (() => void) | undefined;
    let unlistenNotificationAction: PluginListener | undefined;

    void listen<ConnectionEvent>("zeroclaw://connection-status", (event) => {
      setConnection(event.payload);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlistenConnection = dispose;
    });

    void listen<SocketEnvelope>("zeroclaw://socket-message", (event) => {
      if (event.payload.type === "notify") {
        if (document.hidden && event.payload.content) {
          void notify(event.payload.content);
        }
        return;
      }
      ingestEnvelope(event.payload);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlistenSocket = dispose;
    });

    void listen("zeroclaw://tray-new-session", () => {
      void createSessionAndLoad();
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlistenTrayNewSession = dispose;
    });

    void onAction(async () => {
      await invoke("show_main_window_command");
    }).then((dispose) => {
      if (disposed) {
        void dispose.unregister();
        return;
      }
      unlistenNotificationAction = dispose;
    });

    return () => {
      disposed = true;
      unlistenConnection?.();
      unlistenSocket?.();
      unlistenTrayNewSession?.();
      void unlistenNotificationAction?.unregister();
    };
  }, [
    hydrateHistory,
    ingestEnvelope,
    setActiveSession,
    setConnection,
    setSessions,
    setTree,
    setWorkspace
  ]);
}
