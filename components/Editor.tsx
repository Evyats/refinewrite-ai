
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { RefinementChunk } from '../types';

interface EditorProps {
  text: string;
  chunks: RefinementChunk[];
  onChange: (text: string) => void;
  isLoading: boolean;
}

const Editor: React.FC<EditorProps> = ({ text, chunks, onChange, isLoading }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const lastSyncedHtmlRef = useRef<string>('');

  // Sync state to HTML logic
  useEffect(() => {
    if (!editorRef.current) return;

    // During streaming or after refinement, generate structured HTML
    let targetHtml = '';
    if (chunks.length > 0) {
      targetHtml = chunks.map(chunk => {
        const escapedText = chunk.t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        if (chunk.o) {
          const escapedOriginal = chunk.o.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          return `<span class="changed-text" data-original="${escapedOriginal}">${escapedText}<span class="tooltip">Original: ${escapedOriginal}</span></span>`;
        }
        return escapedText.replace(/\n/g, '<br/>');
      }).join('');
    } else {
      // If no chunks, just plain text
      targetHtml = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, '<br/>');
    }

    // Always sync if we are loading (streaming updates) or if content differs and user isn't typing
    if (isLoading || (targetHtml !== lastSyncedHtmlRef.current && !isFocused)) {
      editorRef.current.innerHTML = targetHtml;
      lastSyncedHtmlRef.current = targetHtml;
    }
  }, [chunks, text, isFocused, isLoading]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      const newText = editorRef.current.innerText;
      lastSyncedHtmlRef.current = editorRef.current.innerHTML;
      onChange(newText);
    }
  }, [onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, pastedText);
  }, []);

  return (
    <div className="relative flex-grow flex flex-col min-h-[500px]">
      <div
        ref={editorRef}
        contentEditable={!isLoading}
        onInput={handleInput}
        onPaste={handlePaste}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          lastSyncedHtmlRef.current = ''; 
        }}
        data-placeholder="Start typing or paste your text here..."
        className={`
          editor-content outline-none text-lg leading-relaxed text-gray-800 h-full w-full min-h-full whitespace-pre-wrap p-6
          ${isLoading ? 'opacity-90' : 'cursor-text'}
        `}
        style={{ fontFamily: 'Inter, sans-serif' }}
      />
      
      {isLoading && chunks.length === 0 && (
        <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-20 backdrop-blur-[1px]">
          <div className="flex items-center gap-3 bg-white px-6 py-3 rounded-2xl shadow-lg border border-gray-100">
            <div className="w-5 h-5 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-900 font-bold text-xs tracking-widest">INITIALIZING AI...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Editor;
