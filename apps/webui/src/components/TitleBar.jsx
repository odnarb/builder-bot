// components/TitleBar.jsx
import React from 'react';

export default function TitleBar() {
    const handleMinimize = () => window.electronAPI?.window?.minimize();
    const handleMaximize = () => window.electronAPI?.window?.maximize();
    const handleClose = () => window.electronAPI?.window?.close();

    return (
        <div className="flex justify-end  bg-gray-800 text-white select-none drag-none">
            <button onClick={handleMinimize} className="w-10 h-10 flex items-center justify-center hover:bg-gray-700 rounded text-xl">&#8211;</button>
            <button onClick={handleMaximize} className="w-10 h-10 flex items-center justify-center hover:bg-gray-700 rounded text-xl">&#9633;</button>
            <button onClick={handleClose} className="w-10 h-10 flex items-center justify-center hover:bg-red-700 rounded text-xl ">&times;</button>
        </div>
    );
}
