import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from '../config/appConfig';

export const useTheme = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => localStorage.getItem(THEME_STORAGE_KEY) === 'dark');

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  return {
    isDarkMode,
    toggleDarkMode: () => setIsDarkMode((previous) => !previous),
  };
};
