import { getCurrentWindow } from '@tauri-apps/api/window';
import { PanelLeftClose, PanelLeftOpen, Minus, Square, X, Menu } from 'lucide-react';
import { useState, useEffect } from 'react';

type Connection = {
    status: 'connected' | 'waiting' | 'disconnected';
    detail?: string;
};

export function TitleBar({
    isSidebarOpen,
    toggleSidebar,
    sidebarWidth,
    connection,
    previewPath,
    isChatCollapsed,
    toggleChat
}: {
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
    sidebarWidth: number;
    connection: Connection;
    previewPath?: string;
    isChatCollapsed?: boolean;
    toggleChat?: () => void;
}) {
    const [isMaximized, setIsMaximized] = useState(false);
    const appWindow = getCurrentWindow();

    useEffect(() => {
        let unlisten: () => void;
        appWindow.onResized(() => {
            appWindow.isMaximized().then(setIsMaximized);
        }).then(_unlisten => { unlisten = _unlisten; });
        appWindow.isMaximized().then(setIsMaximized);
        return () => { if (unlisten) unlisten(); };
    }, [appWindow]);

    return (
        <div className="h-[40px] flex justify-between items-center bg-[#F9F9F9] border-b border-[#E5E5E5] px-3 select-none flex-shrink-0 relative">

            {/* Chat toggle — absolute at sidebar right edge (only when sidebar is open) */}
            {previewPath && toggleChat && isSidebarOpen && (
                <button
                    onClick={toggleChat}
                    style={{ left: sidebarWidth - 12 }}
                    className={`absolute z-20 transition-all duration-300 pointer-events-auto flex items-center justify-center w-[24px] h-[24px] rounded
                        ${isChatCollapsed
                            ? 'text-[#D97A5B] bg-[#FFF1EB] hover:bg-[#FFE4D6]'
                            : 'text-gray-500 hover:bg-gray-200 hover:text-gray-800'}`}
                    title={isChatCollapsed ? "Show chat" : "Collapse chat"}
                >
                    {isChatCollapsed
                        ? <PanelLeftClose size={15} strokeWidth={2} className="-scale-x-100" />
                        : <PanelLeftOpen size={15} strokeWidth={2} className="-scale-x-100" />}
                </button>
            )}

            {/* Left controls */}
            <div className="flex items-center gap-4 text-gray-500 z-10">
                <button className="hover:text-gray-800 transition-colors pointer-events-auto" title="Menu">
                    <Menu size={16} strokeWidth={2} />
                </button>

                <button
                    onClick={toggleSidebar}
                    className={`transition-colors pointer-events-auto flex items-center justify-center w-[24px] h-[24px] rounded ${!isSidebarOpen ? 'text-[#D97A5B] bg-[#FFF1EB] hover:bg-[#FFE4D6]' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-800'}`}
                    title={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
                >
                    {isSidebarOpen
                        ? <PanelLeftClose size={15} strokeWidth={2} />
                        : <PanelLeftOpen size={15} strokeWidth={2} />}
                </button>

                {/* Chat toggle inline — only when sidebar is collapsed */}
                {previewPath && toggleChat && !isSidebarOpen && (
                    <button
                        onClick={toggleChat}
                        className={`transition-colors pointer-events-auto flex items-center justify-center w-[24px] h-[24px] rounded ${isChatCollapsed ? 'text-[#D97A5B] bg-[#FFF1EB] hover:bg-[#FFE4D6]' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-800'}`}
                        title={isChatCollapsed ? "Show chat" : "Collapse chat"}
                    >
                        {isChatCollapsed
                            ? <PanelLeftClose size={15} strokeWidth={2} className="-scale-x-100" />
                            : <PanelLeftOpen size={15} strokeWidth={2} className="-scale-x-100" />}
                    </button>
                )}


            </div>

            {/* Draggable spacer */}
            <div data-tauri-drag-region className="flex-1 h-full mx-2 cursor-default" />

            {/* Right: connection status + window controls */}
            <div className="flex items-center gap-3 text-gray-500 z-10">

                {/* Connection Status */}
                <div
                    className="flex items-center justify-center p-1 rounded-full cursor-help hover:bg-gray-100"
                    title={connection.detail || connection.status}
                >
                    <div className="relative flex items-center justify-center w-3 h-3">
                        {connection.status === 'waiting' && (
                            <span className="absolute w-3 h-3 rounded-full bg-amber-400 opacity-75 animate-ping" />
                        )}
                        <span className={`relative w-2 h-2 rounded-full shadow-sm ${connection.status === 'connected' ? 'bg-emerald-500' :
                            connection.status === 'waiting' ? 'bg-amber-500' :
                                'bg-red-500'
                            }`} />
                    </div>
                </div>

                {/* Window Controls */}
                <button
                    onClick={() => appWindow.minimize()}
                    className="hover:text-gray-800 hover:bg-gray-200 p-1.5 rounded transition-colors"
                    title="Minimize"
                >
                    <Minus size={16} strokeWidth={2} />
                </button>
                <button
                    onClick={() => appWindow.toggleMaximize()}
                    className="hover:text-gray-800 hover:bg-gray-200 p-1.5 rounded transition-colors"
                    title={isMaximized ? "Restore" : "Maximize"}
                >
                    <Square size={14} strokeWidth={2} />
                </button>
                <button
                    onClick={() => appWindow.close()}
                    className="hover:text-white hover:bg-red-500 p-1.5 rounded transition-colors"
                    title="Close"
                >
                    <X size={16} strokeWidth={2} />
                </button>
            </div>
        </div>
    );
}
