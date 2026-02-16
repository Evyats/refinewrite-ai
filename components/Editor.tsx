import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefinementChunk } from '../types';
import { EDITOR_MOTION } from '../constants/motion';
import { buildEditorHtml, insertPlainTextAtSelection, placeCaretAtTextNodeEnd } from '../utils/editorHtml';

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
  const lastSyncedHtmlRef = useRef('');
  const unmarkTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      unmarkTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      unmarkTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    const targetHtml = buildEditorHtml(chunks, text, isDarkMode);
    if (isLoading || (targetHtml !== lastSyncedHtmlRef.current && !isFocused)) {
      editorRef.current.innerHTML = targetHtml;
      lastSyncedHtmlRef.current = targetHtml;
    }
  }, [chunks, text, isDarkMode, isFocused, isLoading]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) {
      return;
    }

    lastSyncedHtmlRef.current = editorRef.current.innerHTML;
    onChange(editorRef.current.innerText);
  }, [onChange]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editorRef.current || chunks.length === 0) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const changedNode = target?.closest('.changed-text') as HTMLElement | null;
      if (!changedNode) {
        return;
      }

      event.preventDefault();
      const indexAttr = changedNode.dataset.chunkIndex;
      const chunkIndex = typeof indexAttr === 'string' ? Number(indexAttr) : NaN;
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunks.length) {
        return;
      }

      const burst = document.createElement('span');
      burst.className = 'changed-burst';
      for (let i = 0; i < EDITOR_MOTION.burstDotCount; i += 1) {
        const dot = document.createElement('span');
        dot.className = 'changed-burst-dot';
        dot.style.setProperty('--burst-angle', `${i * (360 / EDITOR_MOTION.burstDotCount)}deg`);
        dot.style.setProperty('--burst-distance', `${16 + (i % 2) * 6}px`);
        burst.appendChild(dot);
      }
      changedNode.appendChild(burst);
      changedNode.classList.add('changed-text-unmarking');

      const timerId = window.setTimeout(() => {
        if (!editorRef.current) {
          return;
        }

        changedNode.querySelector('.tooltip')?.remove();

        const parent = changedNode.parentNode;
        if (!parent) {
          return;
        }

        const newToken = changedNode.dataset.newToken || changedNode.textContent || '';
        const insertedTextNode = document.createTextNode(newToken);
        parent.insertBefore(insertedTextNode, changedNode);
        parent.removeChild(changedNode);

        editorRef.current.focus();
        placeCaretAtTextNodeEnd(insertedTextNode);

        const nextChunks = chunks.map((chunk, index) => (index === chunkIndex ? { t: chunk.t, o: null } : chunk));
        lastSyncedHtmlRef.current = editorRef.current.innerHTML;
        onChange(editorRef.current.innerText, nextChunks);
      }, EDITOR_MOTION.unmarkDurationMs);

      unmarkTimersRef.current.push(timerId);
    },
    [chunks, onChange]
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const pastedText = event.clipboardData.getData('text/plain');
      insertPlainTextAtSelection(pastedText);
      handleInput();
    },
    [handleInput]
  );

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
          editor-content outline-none text-lg leading-relaxed flex-1 w-full min-h-[500px] whitespace-pre-wrap p-6 transition-colors
          ${isDarkMode ? 'text-slate-100' : 'text-gray-800'}
          ${isLoading ? 'opacity-90' : 'cursor-text'}
        `}
        style={{
          fontFamily: 'Inter, sans-serif',
          transitionDuration: 'var(--theme-transition-ms)',
        }}
      />
    </div>
  );
};

export default Editor;
