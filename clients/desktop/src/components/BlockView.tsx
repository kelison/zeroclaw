import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { codeToHtml } from "shiki";
import {
  Copy,
  Download,
  FileCode2,
  Image as ImageIcon,
  Paperclip
} from "lucide-react";
import type { Block } from "../types";

function ActionButton({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className="ghost-button" onClick={onClick} type="button">
      {children}
      {label}
    </button>
  );
}

function escapeCsvCell(value: string) {
  const escaped = value.replaceAll("\"", "\"\"");
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const [exported, setExported] = useState(false);

  const exportCsv = () => {
    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\n");
    downloadTextFile(csv, "zeroclaw-table.csv", "text/csv;charset=utf-8");
    setExported(true);
    window.setTimeout(() => setExported(false), 1600);
  };

  return (
    <div className="block-card">
      <div className="block-actions">
        <ActionButton label={exported ? "Exported" : "Export CSV"} onClick={exportCsv}>
          <Download size={14} />
        </ActionButton>
      </div>
      <div className="overflow-x-auto">
        <table className="block-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${index}-${row.join("|")}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${index}-${cellIndex}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CodeBlock({
  lang,
  content
}: {
  lang?: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    void codeToHtml(content, {
      lang: lang || "text",
      theme: "github-dark"
    })
      .then((html) => {
        if (!cancelled) {
          setHighlightedHtml(html);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedHtml("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [content, lang]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="block-card code-block-card">
      <div className="block-header">
        <div className="block-label">
          {lang || "code"}
        </div>
        <ActionButton label={copied ? "Copied" : "Copy"} onClick={() => void copyCode()}>
          <Copy size={14} />
        </ActionButton>
      </div>
      {highlightedHtml ? (
        <div
          className="shiki-shell"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="fallback-code">
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
}

export function BlockView({
  block,
  onPreviewFile,
  onAttachFile,
  onRevealPath
}: {
  block: Block;
  onPreviewFile?: (path: string) => void;
  onAttachFile?: (path: string) => void;
  onRevealPath?: (path: string) => void;
}) {
  const [attached, setAttached] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);

  if (block.type === "code") {
    return <CodeBlock lang={block.lang} content={block.content} />;
  }

  if (block.type === "table") {
    return <TableBlock headers={block.headers} rows={block.rows} />;
  }

  if (block.type === "image") {
    const src = convertFileSrc(block.path);
    const copyPath = async () => {
      await navigator.clipboard.writeText(block.path);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1400);
    };

    return (
      <div className="block-card asset-block-card">
        <div className="block-header">
          <div className="block-label with-icon">
          <ImageIcon size={14} />
          image
          </div>
        </div>
        <div className="image-frame">
          <img
            alt={block.path}
            className="max-h-72 w-full object-cover"
            loading="lazy"
            src={src}
          />
        </div>
        <div className="asset-path">{block.path}</div>
        <div className="block-actions">
          <ActionButton onClick={() => void copyPath()} label={pathCopied ? "Copied" : "Copy Path"}>
            <Copy size={14} />
          </ActionButton>
          {onRevealPath && (
            <ActionButton onClick={() => onRevealPath(block.path)} label="Reveal">
              <FileCode2 size={14} />
            </ActionButton>
          )}
        </div>
      </div>
    );
  }

  if (block.type === "file") {
    const copyPath = async () => {
      await navigator.clipboard.writeText(block.path);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1400);
    };

    const attachFile = () => {
      onAttachFile?.(block.path);
      setAttached(true);
      window.setTimeout(() => setAttached(false), 1400);
    };

    return (
      <div className="block-card asset-block-card">
        <div className="block-header">
          <div className="block-label with-icon">
          <FileCode2 size={14} />
          file
          </div>
        </div>
        <div className="asset-path">{block.path}</div>
        <div className="block-actions">
          {onPreviewFile && (
            <ActionButton onClick={() => onPreviewFile(block.path)} label="Load Preview">
              <FileCode2 size={14} />
            </ActionButton>
          )}
          {onAttachFile && (
            <ActionButton onClick={attachFile} label={attached ? "Attached" : "Attach"}>
              <Paperclip size={14} />
            </ActionButton>
          )}
          <ActionButton onClick={() => void copyPath()} label={pathCopied ? "Copied" : "Copy Path"}>
            <Copy size={14} />
          </ActionButton>
          {onRevealPath && (
            <ActionButton onClick={() => onRevealPath(block.path)} label="Reveal">
              <FileCode2 size={14} />
            </ActionButton>
          )}
        </div>
      </div>
    );
  }

  return <p className="text-block">{block.content}</p>;
}
