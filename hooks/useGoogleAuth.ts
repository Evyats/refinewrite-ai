import { useCallback, useEffect, useState } from 'react';
import { ALLOWED_EMAIL, GOOGLE_CLIENT_ID, MISSING_AUTH_CONFIG, USER_STORAGE_KEY } from '../config/appConfig';
import { UserProfile } from '../types';
import { GoogleAccountsApi, GoogleCredentialResponse } from '../utils/googleAuthTypes';
import { parseJwtPayload } from '../utils/jwt';

declare global {
  interface Window {
    google?: {
      accounts?: GoogleAccountsApi;
    };
  }
}

interface UseGoogleAuthParams {
  user: UserProfile | null;
  setUser: (user: UserProfile | null) => void;
}

export const useGoogleAuth = ({ user, setUser }: UseGoogleAuthParams) => {
  const [authError, setAuthError] = useState<string | null>(null);

  const handleCredentialResponse = useCallback(
    (response: GoogleCredentialResponse) => {
      setAuthError(null);
      if (!response.credential) {
        setAuthError('Google login response is missing a credential token.');
        return;
      }

      const data = parseJwtPayload(response.credential);
      if (!data) {
        setAuthError('Could not decode Google login response.');
        return;
      }

      if (data.email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
        setAuthError(`Access restricted. Only ${ALLOWED_EMAIL} is permitted.`);
        return;
      }

      const nextUser: UserProfile = {
        name: data.name,
        email: data.email,
        picture: data.picture,
      };

      setUser(nextUser);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
    },
    [setUser]
  );

  useEffect(() => {
    if (MISSING_AUTH_CONFIG) {
      setAuthError('Missing auth env config. Set GOOGLE_CLIENT_ID and ALLOWED_EMAIL.');
      return;
    }

    const savedUserRaw = localStorage.getItem(USER_STORAGE_KEY);
    if (savedUserRaw) {
      try {
        const savedUser = JSON.parse(savedUserRaw) as UserProfile;
        if (savedUser?.email?.toLowerCase() === ALLOWED_EMAIL.toLowerCase() && user?.email !== savedUser.email) {
          setUser(savedUser);
        }
      } catch {
        localStorage.removeItem(USER_STORAGE_KEY);
      }
    }
  }, [setUser, user?.email]);

  useEffect(() => {
    if (MISSING_AUTH_CONFIG || user) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const initGoogleButton = () => {
      if (cancelled) {
        return;
      }

      const accounts = window.google?.accounts;
      if (!accounts) {
        timeoutId = window.setTimeout(initGoogleButton, 200);
        return;
      }

      accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
      });

      const buttonContainer = document.getElementById('googleBtn');
      if (buttonContainer) {
        accounts.id.renderButton(buttonContainer, {
          theme: 'outline',
          size: 'large',
          width: buttonContainer.offsetWidth,
          shape: 'pill',
        });
      }
    };

    initGoogleButton();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [handleCredentialResponse, user]);

  const signOut = useCallback(() => {
    setUser(null);
    setAuthError(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    window.google?.accounts?.id.disableAutoSelect();
  }, [setUser]);

  return {
    authError,
    signOut,
    isAuthConfigured: !MISSING_AUTH_CONFIG,
    allowedEmail: ALLOWED_EMAIL,
  };
};
