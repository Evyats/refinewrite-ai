import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BurstPreset, RefinementChunk } from '../types';
import { EDITOR_MOTION } from '../constants/motion';
import { buildEditorHtml, insertPlainTextAtSelection, placeCaretAtTextNodeEnd } from '../utils/editorHtml';

interface EditorProps {
  text: string;
  chunks: RefinementChunk[];
  onChange: (text: string, nextChunks?: RefinementChunk[]) => void;
  isLoading: boolean;
  isDarkMode: boolean;
  burstPreset: BurstPreset;
}

const pushMergedChunk = (list: RefinementChunk[], chunk: RefinementChunk) => {
  if (!chunk.t) {
    return;
  }

  const last = list[list.length - 1];
  if (last && last.o === chunk.o) {
    last.t += chunk.t;
    return;
  }

  list.push(chunk);
};

const extractChunksFromEditorDom = (root: HTMLElement): RefinementChunk[] => {
  const result: RefinementChunk[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushMergedChunk(result, { t: node.textContent || '', o: null });
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as HTMLElement;
    if (element.tagName === 'BR') {
      pushMergedChunk(result, { t: '\n', o: null });
      return;
    }

    if (element.classList.contains('changed-text')) {
      const token = element.dataset.newToken || '';
      const original = element.dataset.original;
      pushMergedChunk(result, { t: token, o: typeof original === 'string' ? original : null });
      return;
    }

    Array.from(element.childNodes).forEach(walk);
  };

  Array.from(root.childNodes).forEach(walk);
  return result;
};

const getCaretRangeFromPoint = (clientX: number, clientY: number): Range | null => {
  const docWithLegacyCaret = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  if (typeof docWithLegacyCaret.caretRangeFromPoint === 'function') {
    return docWithLegacyCaret.caretRangeFromPoint(clientX, clientY);
  }

  if (typeof docWithLegacyCaret.caretPositionFromPoint === 'function') {
    const position = docWithLegacyCaret.caretPositionFromPoint(clientX, clientY);
    if (!position) {
      return null;
    }

    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  return null;
};

const Editor: React.FC<EditorProps> = ({ text, chunks, onChange, isLoading, isDarkMode, burstPreset }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const lastSyncedHtmlRef = useRef('');
  const unmarkTimersRef = useRef<number[]>([]);
  const previousChunksSignatureRef = useRef('');

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

    const chunksSignature = chunks
      .map((chunk) => `${chunk.t}\u0001${chunk.o === null ? '__NULL__' : chunk.o}`)
      .join('\u0002');
    const hasChangedChunks = chunks.some((chunk) => chunk.o !== null);
    const shouldAnimateChangedTokens =
      hasChangedChunks && chunksSignature !== previousChunksSignatureRef.current;
    const targetHtml = buildEditorHtml(chunks, text, isDarkMode, shouldAnimateChangedTokens);

    if (isLoading || (targetHtml !== lastSyncedHtmlRef.current && !isFocused)) {
      editorRef.current.innerHTML = targetHtml;
      lastSyncedHtmlRef.current = targetHtml;
    }

    previousChunksSignatureRef.current = chunksSignature;
  }, [chunks, text, isDarkMode, isFocused, isLoading]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) {
      return;
    }

    lastSyncedHtmlRef.current = editorRef.current.innerHTML;
    const nextText = editorRef.current.innerText;
    if (chunks.length === 0) {
      onChange(nextText);
      return;
    }

    const nextChunks = extractChunksFromEditorDom(editorRef.current);
    onChange(nextText, nextChunks);
  }, [chunks, onChange]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editorRef.current) {
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
      const canApplyTargetedChunkUpdate =
        Number.isInteger(chunkIndex) && chunkIndex >= 0 && chunkIndex < chunks.length;
      const clickedRange = getCaretRangeFromPoint(event.clientX, event.clientY);
      const newTokenText = changedNode.dataset.newToken || changedNode.textContent || '';
      let clickedOffset = newTokenText.length;
      if (clickedRange && changedNode.contains(clickedRange.startContainer)) {
        clickedOffset = Math.max(0, Math.min(newTokenText.length, clickedRange.startOffset));
      }

      const burst = document.createElement('span');
      burst.className = 'changed-burst';
      changedNode.style.setProperty('--unmark-duration-ms', `${burstPreset.durationMs}ms`);
      for (let i = 0; i < burstPreset.particleCount; i += 1) {
        const dot = document.createElement('span');
        dot.className = 'changed-burst-dot';
        let angleDeg = i * (burstPreset.spreadDeg / burstPreset.particleCount);
        if (burstPreset.pattern === 'horizontal') {
          const sideAngle = i % 2 === 0 ? 0 : 180;
          const jitterStep = (Math.floor(i / 2) % 3) - 1; // -1, 0, 1
          angleDeg = sideAngle + jitterStep * 12;
        }
        dot.style.setProperty('--burst-angle', `${angleDeg}deg`);
        dot.style.setProperty(
          '--burst-distance',
          `${burstPreset.baseDistancePx + ((i % 3) - 1) * burstPreset.distanceVariancePx}px`
        );
        dot.style.setProperty('--burst-dot-size', `${burstPreset.dotSizePx}px`);
        burst.appendChild(dot);
      }
      changedNode.appendChild(burst);
      changedNode.classList.add('changed-text-clearing');
      changedNode.classList.add('changed-text-unmarking');
      editorRef.current.focus();
      if (clickedRange && changedNode.contains(clickedRange.startContainer)) {
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(clickedRange);
        }
      }

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
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.setStart(insertedTextNode, Math.max(0, Math.min(clickedOffset, insertedTextNode.length)));
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          placeCaretAtTextNodeEnd(insertedTextNode);
        }

        lastSyncedHtmlRef.current = editorRef.current.innerHTML;
        if (canApplyTargetedChunkUpdate) {
          const nextChunks = chunks.map((chunk, index) => (index === chunkIndex ? { t: chunk.t, o: null } : chunk));
          onChange(editorRef.current.innerText, nextChunks);
          return;
        }

        // If chunk state is already stale/cleared, still allow span -> plain text conversion.
        onChange(editorRef.current.innerText);
      }, burstPreset.durationMs);

      unmarkTimersRef.current.push(timerId);
    },
    [burstPreset, chunks, onChange]
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
          ${isLoading ? 'is-loading' : ''}
          ${isDarkMode ? 'text-slate-100' : 'text-gray-800'}
          ${isLoading ? '' : 'cursor-text'}
        `}
        style={{
          fontFamily: 'Inter, sans-serif',
        }}
      />
    </div>
  );
};

export default Editor;
