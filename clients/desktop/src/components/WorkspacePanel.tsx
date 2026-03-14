import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ExternalLink, FileCode2, FolderOpen, RefreshCw } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import type { FileNode } from "../types";

function TreeNode({
  node,
  onOpen
}: {
  node: FileNode;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(node.is_dir);

  if (node.is_dir) {
    return (
      <div className="space-y-2">
        <button
          className="tree-folder"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <FolderOpen size={15} />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div className="tree-branch">
            {node.children.map((child) => (
              <TreeNode key={child.path} node={child} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className="tree-file"
      draggable
      onClick={() => onOpen(node.path)}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", node.path);
        event.dataTransfer.effectAllowed = "copy";
      }}
      type="button"
    >
      <FileCode2 size={14} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function WorkspacePanel() {
  const workspace = useChatStore((state) => state.workspace);
  const tree = useChatStore((state) => state.tree);
  const previewPath = useChatStore((state) => state.previewPath);
  const previewContent = useChatStore((state) => state.previewContent);
  const setWorkspace = useChatStore((state) => state.setWorkspace);
  const setTree = useChatStore((state) => state.setTree);
  const setPreview = useChatStore((state) => state.setPreview);

  const loadWorkspace = async (path: string) => {
    const nodes = await invoke<FileNode[]>("read_workspace", { path });
    await invoke("save_workspace", { path });
    setWorkspace(path);
    setTree(nodes);
  };

  const pickWorkspace = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await loadWorkspace(selected);
    }
  };

  const openFile = async (path: string) => {
    const content = await invoke<string>("read_file_content", { path });
    setPreview(path, content);
  };

  const revealPreview = async () => {
    if (!previewPath) {
      return;
    }
    await invoke("open_in_explorer", { path: previewPath });
  };

  return (
    <div className="rail-stack">
      <section className="surface-card panel-card">
        <div className="panel-toolbar">
          <div>
            <div className="eyebrow">workspace</div>
            <h2 className="panel-title panel-title-plain">Project files</h2>
          </div>
          <button className="ghost-button" onClick={() => void pickWorkspace()} type="button">
            Open folder
          </button>
        </div>

        <div className="panel-well workspace-path">
          {workspace || "No workspace selected yet."}
        </div>

        {workspace && (
          <button
            className="ghost-button mt-3"
            onClick={() => void loadWorkspace(workspace)}
            type="button"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        )}
      </section>

      <section className="surface-card panel-card">
        <div className="section-heading compact">
          <div className="eyebrow">browser</div>
          <h2 className="panel-title panel-title-plain">Workspace browser</h2>
        </div>

        <div className="workspace-tree">
          {tree.length > 0 ? (
            tree.map((node) => (
              <TreeNode key={node.path} node={node} onOpen={openFile} />
            ))
          ) : (
            <div className="empty-state-panel compact">
              Select a workspace to load a filtered tree view. Hidden files,
              `target/`, and `node_modules/` are skipped.
            </div>
          )}
        </div>
      </section>

      <section className="surface-card panel-card">
        <div className="panel-toolbar">
          <div>
            <div className="eyebrow">preview</div>
            <h2 className="panel-title panel-title-plain">File preview</h2>
          </div>
          {previewPath && (
            <button className="ghost-button" onClick={() => void revealPreview()} type="button">
              <ExternalLink size={14} />
              Reveal
            </button>
          )}
        </div>
        <div className="preview-path">
          {previewPath || "No file selected"}
        </div>
        <pre className="preview-pane">
          {previewContent || "Selected text file content will appear here."}
        </pre>
      </section>
    </div>
  );
}
