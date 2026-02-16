import { RefinementChunk } from '../types';
import { EDITOR_MOTION } from '../constants/motion';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escapeAttr = (value: string) =>
  escapeHtml(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const splitWordsAndSpaces = (value: string) => value.match(/\s+|[^\s]+/g) || [value];

export const buildEditorHtml = (chunks: RefinementChunk[], text: string, isDarkMode: boolean): string => {
  if (chunks.length === 0) {
    return escapeHtml(text).replace(/\n/g, '<br/>');
  }

  let changedRevealOrder = 0;

  return chunks
    .map((chunk, index) => {
      if (!chunk.o) {
        return escapeHtml(chunk.t).replace(/\n/g, '<br/>');
      }

      const escapedOriginal = escapeAttr(chunk.o);
      const changedClass = isDarkMode ? 'changed-text changed-text-dark' : 'changed-text';
      const parts = splitWordsAndSpaces(chunk.t);
      const originalWordParts = splitWordsAndSpaces(chunk.o).filter((part) => !/^\s+$/.test(part));
      let originalWordIndex = 0;

      return parts
        .map((part) => {
          if (/^\s+$/.test(part)) {
            return escapeHtml(part).replace(/\n/g, '<br/>');
          }

          const previousWord = originalWordParts[originalWordIndex] || part;
          originalWordIndex += 1;
          const delayMs = changedRevealOrder * EDITOR_MOTION.revealStaggerMs;
          changedRevealOrder += 1;

          return `<span class="${changedClass}" style="--reveal-delay:${delayMs}ms;" data-new-token="${escapeAttr(part)}" data-original="${escapedOriginal}" data-chunk-index="${index}"><span class="prev-token">${escapeHtml(previousWord)}</span><span class="new-token">${escapeHtml(part)}</span><span class="tooltip">Original: ${escapedOriginal}</span></span>`;
        })
        .join('');
    })
    .join('');
};

export const placeCaretAtTextNodeEnd = (textNode: Text) => {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.setStart(textNode, textNode.textContent?.length || 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

export const insertPlainTextAtSelection = (text: string) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};
