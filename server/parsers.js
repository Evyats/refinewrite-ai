const extractCompleteObjects = (source) => {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        objects.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
};

const sanitizeChunks = (chunks) => {
  if (!Array.isArray(chunks)) {
    return [];
  }

  return chunks
    .filter((item) => item && typeof item.t === 'string' && (typeof item.o === 'string' || item.o === null))
    .map((item) => ({ t: item.t, o: item.o }));
};

const extractTextFromResponsePayload = (payload) => {
  const output = payload?.response?.output;
  if (!Array.isArray(output)) {
    return '';
  }

  let combined = '';
  for (const item of output) {
    const content = item?.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (typeof part?.text === 'string') {
        combined += part.text;
      }
    }
  }

  return combined;
};

module.exports = {
  extractCompleteObjects,
  sanitizeChunks,
  extractTextFromResponsePayload,
};
