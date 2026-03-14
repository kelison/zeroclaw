import { useEffect, useState, useCallback } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { useChatStore } from "../store/chatStore";

export function ContextMenu() {
    const [visible, setVisible] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [hasSelection, setHasSelection] = useState(false);
    const [isEditable, setIsEditable] = useState(false);
    const setPendingPaste = useChatStore((state) => state.setPendingPaste);

    const hide = useCallback(() => setVisible(false), []);

    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();

            const selection = window.getSelection()?.toString() ?? "";
            setHasSelection(selection.length > 0);

            const target = e.target as HTMLElement;
            const editable =
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable;
            setIsEditable(editable);

            const menuW = 210;
            const menuH = 240;
            const x = e.clientX + menuW > window.innerWidth ? e.clientX - menuW : e.clientX;
            const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY;

            setPos({ x, y });
            setVisible(true);
        };

        const handleClick = () => hide();
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };

        document.addEventListener("contextmenu", handleContextMenu);
        document.addEventListener("click", handleClick);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("contextmenu", handleContextMenu);
            document.removeEventListener("click", handleClick);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [hide]);

    const handleUndo = () => { document.execCommand("undo"); hide(); };
    const handleRedo = () => { document.execCommand("redo"); hide(); };
    const handleCut = () => { document.execCommand("cut"); hide(); };
    const handleCopy = () => { document.execCommand("copy"); hide(); };
    const handleSelectAll = () => {
        const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
        if (el && "select" in el) el.select();
        else document.execCommand("selectAll");
        hide();
    };

    const handlePaste = async () => {
        try {
            const text = await readText();
            if (text) setPendingPaste(text);
        } catch (e) {
            console.error("paste failed", e);
        }
        hide();
    };

    if (!visible) return null;

    return (
        <div
            className="fixed z-[9999] bg-white border border-[#E8E8E8] rounded-[12px] shadow-[0_6px_28px_rgba(0,0,0,0.10)] py-1.5 w-[210px] select-none"
            style={{ left: pos.x, top: pos.y }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div className="px-1.5">
                <MenuItem label="撤销" shortcut="Ctrl+Z" disabled={!isEditable} onClick={handleUndo} />
                <MenuItem label="重做" shortcut="Ctrl+Shift+Z" disabled={!isEditable} onClick={handleRedo} />
            </div>

            <Divider />

            <div className="px-1.5">
                <MenuItem label="剪切" shortcut="Ctrl+X" disabled={!hasSelection || !isEditable} onClick={handleCut} />
                <MenuItem label="复制" shortcut="Ctrl+C" disabled={!hasSelection} onClick={handleCopy} />
                <MenuItem label="粘贴" shortcut="Ctrl+V" disabled={!isEditable} onClick={() => void handlePaste()} />
            </div>

            <Divider />

            <div className="px-1.5">
                <MenuItem label="全选" shortcut="Ctrl+A" disabled={!isEditable} onClick={handleSelectAll} />
            </div>
        </div>
    );
}

function MenuItem({
    label, shortcut, disabled, onClick,
}: {
    label: string;
    shortcut?: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            disabled={disabled}
            onClick={onClick}
            className={`w-full flex items-center justify-between px-2.5 py-[8px] text-[13.5px] rounded-[7px] transition-colors text-left
        ${disabled
                    ? "text-gray-300 cursor-default"
                    : "text-[#1A1A1A] hover:bg-[#F3F3F3] cursor-pointer"
                }`}
        >
            <span>{label}</span>
            {shortcut && (
                <span className={`text-[11.5px] ${disabled ? "text-gray-300" : "text-gray-400"}`}>
                    {shortcut}
                </span>
            )}
        </button>
    );
}

function Divider() {
    return <div className="my-1.5 border-t border-[#EFEFEF]" />;
}
