export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL || '';
export const MISSING_AUTH_CONFIG = !GOOGLE_CLIENT_ID || !ALLOWED_EMAIL;

export const THEME_STORAGE_KEY = 'refinewrite_theme';
export const USER_STORAGE_KEY = 'refine_write_user';

export const DEFAULT_STARTER_TEXT = "refinewrite is suposed to help me write better, but this paragrpah have lots of bad wording and grammer mistakes that makes it hard to read.  i also put weird  spacing and random capitalization so the tool can clean things up quickly and show if it actualy works good.\n\nyesterday i was trying to send an important mesage to a client, and i write it too fast so the tone were confusing, the punctuation is off , and some words are totaly the wrong choise.  if this app works nice it should make this mess look clear, profesional, and easy to understand without changing what i realy mean.";
