const ALLOWED_TYPES = new Set(['slight', 'prettier', 'revision', 'filler', 'custom']);

const getSystemInstruction = (type, customInstruction) => {
  switch (type) {
    case 'slight':
      return `You are a surgical editor. Perform MINIMAL changes.
Only fix: 1. Blatant spelling/grammar errors. 2. Weakest word choices.
Do NOT change the tone, style, or structure. If a sentence is fine, leave it exactly as is.
Return an array of segments mapping new text to original text if changed.`;
    case 'prettier':
      return 'You are a formatting expert. Only fix capitalization and remove extra spaces. Do not change words. Return an array of segments mapping new text to original text if changed.';
    case 'revision':
      return 'You are an expert writer. Revise for clarity and flow while keeping original intent. Return an array of segments mapping new text to original text if changed.';
    case 'filler':
      return "Identify '___' and fill with context-appropriate words. Return segments where '___' is original text.";
    case 'custom':
      return `Follow: "${customInstruction || ''}". Return an array of segments mapping new text to original text if changed.`;
    default:
      return '';
  }
};

module.exports = {
  ALLOWED_TYPES,
  getSystemInstruction,
};
