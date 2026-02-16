import { GoogleJwtPayload } from './googleAuthTypes';

export const parseJwtPayload = (token: string): GoogleJwtPayload | null => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((char) => `%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join('')
    );
    const parsed = JSON.parse(jsonPayload);

    if (
      typeof parsed?.name === 'string' &&
      typeof parsed?.email === 'string' &&
      typeof parsed?.picture === 'string'
    ) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
};
