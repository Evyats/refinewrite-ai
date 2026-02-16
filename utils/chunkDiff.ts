import { RefinementChunk } from '../types';

type DiffOp = { type: 'equal' | 'add' | 'delete'; token: string };

const tokenize = (text: string): string[] => {
  const tokens = text.match(/\s+|[A-Za-z0-9_]+|[^A-Za-z0-9_\s]/g);
  return tokens || [];
};

const diffTokens = (source: string[], target: string[]): DiffOp[] => {
  const n = source.length;
  const m = target.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (source[i - 1] === target[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && source[i - 1] === target[j - 1]) {
      ops.push({ type: 'equal', token: source[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', token: target[j - 1] });
      j -= 1;
    } else {
      ops.push({ type: 'delete', token: source[i - 1] });
      i -= 1;
    }
  }

  return ops.reverse();
};

const pushChunk = (list: RefinementChunk[], chunk: RefinementChunk) => {
  if (!chunk.t) {
    return;
  }

  const last = list[list.length - 1];
  if (last && last.o === chunk.o) {
    last.t += chunk.t;
    if (last.o && chunk.o) {
      last.o += chunk.o;
    }
    return;
  }

  list.push(chunk);
};

const splitChangedChunk = (original: string, updated: string): RefinementChunk[] => {
  const sourceTokens = tokenize(original);
  const targetTokens = tokenize(updated);
  const ops = diffTokens(sourceTokens, targetTokens);

  const output: RefinementChunk[] = [];
  let pendingDeleted = '';
  let pendingAdded = '';

  const flushPending = () => {
    if (!pendingAdded) {
      pendingDeleted = '';
      return;
    }

    pushChunk(output, { t: pendingAdded, o: pendingDeleted || null });
    pendingDeleted = '';
    pendingAdded = '';
  };

  for (const op of ops) {
    if (op.type === 'equal') {
      flushPending();
      pushChunk(output, { t: op.token, o: null });
      continue;
    }

    if (op.type === 'delete') {
      pendingDeleted += op.token;
      continue;
    }

    pendingAdded += op.token;
  }

  flushPending();
  return output.length > 0 ? output : [{ t: updated, o: original }];
};

export const granularizeChunks = (chunks: RefinementChunk[]): RefinementChunk[] => {
  const output: RefinementChunk[] = [];

  for (const chunk of chunks) {
    if (chunk.o === null) {
      pushChunk(output, chunk);
      continue;
    }

    const split = splitChangedChunk(chunk.o, chunk.t);
    for (const part of split) {
      pushChunk(output, part);
    }
  }

  return output;
};
