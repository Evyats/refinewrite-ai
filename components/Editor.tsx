
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { RefinementChunk } from '../types';

interface EditorProps {
  text: string;
  chunks: RefinementChunk[];
  onChange: (text: string, nextChunks?: RefinementChunk[]) => void;
  isLoading: boolean;
  isDarkMode: boolean;
}

const Editor: React.FC<EditorProps> = ({ text, chunks, onChange, isLoading, isDarkMode }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const lastSyncedHtmlRef = useRef<string>('');
  const unmarkTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      unmarkTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      unmarkTimersRef.current = [];
    };
  }, []);

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const escapeAttr = (value: string) =>
    escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  // Sync state to HTML logic
  useEffect(() => {
    if (!editorRef.current) return;

    // During streaming or after refinement, generate structured HTML
    let targetHtml = '';
    if (chunks.length > 0) {
      let changedRevealOrder = 0;
      targetHtml = chunks.map((chunk, index) => {
        if (chunk.o) {
          const escapedOriginal = escapeAttr(chunk.o);
          const changedClass = isDarkMode ? 'changed-text changed-text-dark' : 'changed-text';
          const parts = chunk.t.match(/\s+|[^\s]+/g) || [chunk.t];
          const originalWordParts = (chunk.o.match(/\s+|[^\s]+/g) || [chunk.o]).filter((part) => !/^\s+$/.test(part));
          let originalWordIndex = 0;

          return parts.map((part) => {
            const escapedPart = escapeHtml(part);
            if (/^\s+$/.test(part)) {
              return escapedPart.replace(/\n/g, '<br/>');
            }

            const prevWord = originalWordParts[originalWordIndex] || part;
            originalWordIndex += 1;
            const escapedPrevWord = escapeHtml(prevWord);
            const staggerDelayMs = changedRevealOrder * 100;
            changedRevealOrder += 1;
            return `<span class="${changedClass}" style="--reveal-delay:${staggerDelayMs}ms;" data-new-token="${escapeAttr(part)}" data-original="${escapedOriginal}" data-chunk-index="${index}"><span class="prev-token">${escapedPrevWord}</span><span class="new-token">${escapedPart}</span><span class="tooltip">Original: ${escapedOriginal}</span></span>`;
          }).join('');
        }
        const escapedText = escapeHtml(chunk.t);
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

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!editorRef.current || chunks.length === 0) return;
    const target = e.target as HTMLElement | null;
    const changedNode = target?.closest('.changed-text') as HTMLElement | null;
    if (!changedNode) return;
    e.preventDefault();

    const indexAttr = changedNode.dataset.chunkIndex;
    const chunkIndex = typeof indexAttr === 'string' ? Number(indexAttr) : NaN;
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunks.length) {
      return;
    }

    const burst = document.createElement('span');
    burst.className = 'changed-burst';
    for (let i = 0; i < 6; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'changed-burst-dot';
      dot.style.setProperty('--burst-angle', `${i * 60}deg`);
      dot.style.setProperty('--burst-distance', `${16 + (i % 2) * 6}px`);
      burst.appendChild(dot);
    }
    changedNode.appendChild(burst);
    changedNode.classList.add('changed-text-unmarking');

    const timerId = window.setTimeout(() => {
      if (!editorRef.current) return;

      const tooltip = changedNode.querySelector('.tooltip');
      if (tooltip) {
        tooltip.remove();
      }

      const parent = changedNode.parentNode;
      if (!parent) return;
      const newToken = changedNode.dataset.newToken || changedNode.textContent || '';
      const insertedTextNode = document.createTextNode(newToken);
      parent.insertBefore(insertedTextNode, changedNode);
      parent.removeChild(changedNode);

      editorRef.current.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        const textLen = insertedTextNode.textContent?.length || 0;
        range.setStart(insertedTextNode, textLen);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      const newText = editorRef.current.innerText;
      lastSyncedHtmlRef.current = editorRef.current.innerHTML;
      const nextChunks = chunks.map((chunk, i) => (i === chunkIndex ? { t: chunk.t, o: null } : chunk));
      onChange(newText, nextChunks);
    }, 220);

    unmarkTimersRef.current.push(timerId);
  }, [chunks, onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, pastedText);
  }, []);

  return (
    <div className="relative flex-grow flex flex-col min-h-[500px]">
      {isLoading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden pointer-events-none z-10">
          <div className="editor-loading-shimmer h-full w-1/3"></div>
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable={!isLoading}
        onInput={handleInput}
        onPaste={handlePaste}
        onFocus={() => setIsFocused(true)}
        onMouseDown={handleMouseDown}
        onBlur={() => {
          setIsFocused(false);
          lastSyncedHtmlRef.current = ''; 
        }}
        data-placeholder="Start typing or paste your text here..."
        className={`
          editor-content outline-none text-lg leading-relaxed flex-1 w-full min-h-[500px] whitespace-pre-wrap p-6 transition-colors duration-500
          ${isDarkMode ? 'text-slate-100' : 'text-gray-800'}
          ${isLoading ? 'opacity-90' : 'cursor-text'}
        `}
        style={{ fontFamily: 'Inter, sans-serif' }}
      />
      
    </div>
  );
};

export default Editor;
