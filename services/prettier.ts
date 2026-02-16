export const deterministicPrettier = (input: string): string => {
  const normalizedWhitespace = input
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/[ ]+([.,!?;:])/g, '$1')
    .replace(/([.,!?;:])([^\s\n])/g, '$1 $2');

  let result = '';
  let shouldCapitalize = true;

  for (let index = 0; index < normalizedWhitespace.length; index += 1) {
    const char = normalizedWhitespace[index];
    if (shouldCapitalize && /[a-zA-Z]/.test(char)) {
      result += char.toUpperCase();
      shouldCapitalize = false;
      continue;
    }

    result += char;

    if (/[.!?]/.test(char)) {
      shouldCapitalize = true;
    }
  }

  return result;
};
