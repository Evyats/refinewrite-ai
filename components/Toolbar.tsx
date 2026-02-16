
import React, { useState } from 'react';
import { RefinementType } from '../types';

interface ToolbarProps {
  onRefine: (type: RefinementType, customPrompt?: string) => void;
  onCopy: () => void;
  isLoading: boolean;
  onClear: () => void;
  onLoadDefaultText: () => void;
  isDarkMode: boolean;
}

const Toolbar: React.FC<ToolbarProps> = ({ onRefine, onCopy, isLoading, onClear, onLoadDefaultText, isDarkMode }) => {
  const [customInput, setCustomInput] = useState('');

  const buttons = [
    { type: RefinementType.SLIGHT, label: 'Slight', icon: '✨', description: 'Grammar, spelling, and surgical fixes.' },
    { type: RefinementType.PRETTIER, label: 'Prettier', icon: '🎨', description: 'Fix spacing and caps.' },
    { type: RefinementType.REVISION, label: 'Revise', icon: '📝', description: 'Full professional rewrite.' },
    { type: RefinementType.FILLER, label: 'Fill', icon: '🕳️', description: 'Replace "___" placeholders.' },
  ];

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customInput.trim()) {
      onRefine(RefinementType.CUSTOM, customInput);
    }
  };

  return (
    <div className={`flex flex-col gap-3 p-4 border-b sticky top-0 z-10 shadow-sm transition-colors duration-500 ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2 flex-grow">
          {buttons.map((btn) => (
            <button
              key={btn.type}
              onClick={() => onRefine(btn.type)}
              disabled={isLoading}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all
                ${isLoading 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : isDarkMode
                    ? 'bg-indigo-950/60 text-indigo-200 hover:bg-indigo-900 active:scale-95 border border-indigo-800/70 shadow-sm'
                    : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 active:scale-95 border border-indigo-100 shadow-sm'}
              `}
              title={btn.description}
            >
              <span>{btn.icon}</span>
              <span>{btn.label}</span>
            </button>
          ))}
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={onLoadDefaultText}
            disabled={isLoading}
            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'text-slate-400 hover:text-indigo-200 hover:bg-indigo-900/30' : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
            title="Load default sample text"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.8 9A7 7 0 0119 11M18.2 15A7 7 0 015 13" />
            </svg>
          </button>
          <button
            onClick={onClear}
            disabled={isLoading}
            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'text-slate-400 hover:text-red-300 hover:bg-red-900/30' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}
            title="Clear editor"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={onCopy}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 shadow-md ${isDarkMode ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-gray-900 text-white hover:bg-black'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            Copy
          </button>
        </div>
      </div>

      <form onSubmit={handleCustomSubmit} className="flex gap-2">
        <div className="relative flex-grow">
          <input 
            type="text"
            id="custom-instruction"
            name="customInstruction"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="Custom instruction (e.g. 'Make it more formal', 'Translate to German'...)"
            disabled={isLoading}
            className={`w-full border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-400' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
          />
          <button 
            type="submit"
            disabled={isLoading || !customInput.trim()}
            className={`absolute right-1 top-1 bottom-1 px-3 rounded-lg text-xs font-bold transition-all
              ${isLoading || !customInput.trim() ? 'bg-gray-200 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'}
            `}
          >
            Run
          </button>
        </div>
      </form>
    </div>
  );
};

export default Toolbar;
