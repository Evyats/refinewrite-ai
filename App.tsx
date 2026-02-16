
import React, { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { RefinementType, EditorState, UserProfile, RefinementChunk } from './types';
import { refineTextStream } from './services/openai';
import Toolbar from './components/Toolbar';
import Editor from './components/Editor';

declare global {
  interface Window {
    google: any;
  }
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL || '';
const MISSING_AUTH_CONFIG = !GOOGLE_CLIENT_ID || !ALLOWED_EMAIL;
const DEFAULT_STARTER_TEXT = "refinewrite is suposed to help me write better, but this paragrpah have lots of bad wording and grammer mistakes that makes it hard to read.  i also put weird  spacing and random capitalization so the tool can clean things up quickly and show if it actualy works good.\n\nyesterday i was trying to send an important mesage to a client, and i write it too fast so the tone were confusing, the punctuation is off , and some words are totaly the wrong choise.  if this app works nice it should make this mess look clear, profesional, and easy to understand without changing what i realy mean.";

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
  if (!chunk.t) return;
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
    const originalText = pendingDeleted || null;
    pushChunk(output, { t: pendingAdded, o: originalText });
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

const granularizeChunks = (chunks: RefinementChunk[]): RefinementChunk[] => {
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

const App: React.FC = () => {
  const [state, setState] = useState<EditorState>({
    text: DEFAULT_STARTER_TEXT,
    chunks: [],
    isLoading: false,
    error: null,
    user: null,
    customInstruction: '',
  });

  const [authError, setAuthError] = useState<string | null>(null);
  const [networkInfo, setNetworkInfo] = useState<{ origin: string; host: string; port: string; localIPs: string[] }>({
    origin: window.location.origin,
    host: window.location.host,
    port: window.location.port,
    localIPs: [],
  });
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => localStorage.getItem('refinewrite_theme') === 'dark');

  const parseJwt = (token: string) => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  };

  const handleCredentialResponse = (response: any) => {
    setAuthError(null);
    const data = parseJwt(response.credential);
    
    if (data) {
      if (!data.email) {
        setAuthError('Could not read email from Google login response.');
        return;
      }

      if (data.email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
        setAuthError(`Access restricted. Only ${ALLOWED_EMAIL} is permitted.`);
        return;
      }

      const user: UserProfile = {
        name: data.name,
        email: data.email,
        picture: data.picture,
      };
      setState(prev => ({ ...prev, user }));
      localStorage.setItem('refine_write_user', JSON.stringify(user));
    }
  };

  useEffect(() => {
    localStorage.setItem('refinewrite_theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    const loadNetworkInfo = async () => {
      try {
        const res = await fetch('/api/network-info');
        if (!res.ok) return;
        const data = await res.json();
        setNetworkInfo({
          origin: data?.origin || window.location.origin,
          host: data?.host || window.location.host,
          port: data?.port || window.location.port,
          localIPs: Array.isArray(data?.localIPs) ? data.localIPs : [],
        });
      } catch {
        // Best-effort helper info for OAuth setup.
      }
    };

    loadNetworkInfo();
  }, []);

  useEffect(() => {
    if (MISSING_AUTH_CONFIG) {
      setAuthError('Missing auth env config. Set GOOGLE_CLIENT_ID and ALLOWED_EMAIL.');
      return;
    }

    const savedUser = localStorage.getItem('refine_write_user');
    if (savedUser) {
      const user = JSON.parse(savedUser);
      const savedEmail = typeof user?.email === 'string' ? user.email.toLowerCase() : '';
      const currentEmail = state.user?.email?.toLowerCase() || '';

      if (savedEmail === ALLOWED_EMAIL.toLowerCase() && currentEmail !== savedEmail) {
        setState(prev => ({ ...prev, user }));
      } else if (savedEmail !== ALLOWED_EMAIL.toLowerCase()) {
        localStorage.removeItem('refine_write_user');
      }
    }

    const initGsi = () => {
      if (window.google?.accounts) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          auto_select: false,
        });

        const btnContainer = document.getElementById("googleBtn");
        if (btnContainer && !state.user) {
          window.google.accounts.id.renderButton(btnContainer, {
            theme: "outline",
            size: "large",
            width: btnContainer.offsetWidth,
            shape: "pill"
          });
        }
      } else {
        setTimeout(initGsi, 200);
      }
    };

    if (!state.user) {
      initGsi();
    }
  }, [state.user]);

  const handleTextChange = useCallback((newText: string, nextChunks?: RefinementChunk[]) => {
    if (nextChunks) {
      setState(prev => ({ ...prev, text: newText, chunks: nextChunks }));
      return;
    }
    setState(prev => ({ ...prev, text: newText, chunks: [] }));
  }, []);

  const handleRefine = async (type: RefinementType, customPrompt?: string) => {
    if (!state.text.trim()) {
      setState(prev => ({ ...prev, error: "Please enter some text first." }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null, chunks: [] }));
    
    try {
      await refineTextStream(
        state.text, 
        type, 
        (incomingChunks) => {
          const granularChunks = granularizeChunks(incomingChunks);
          const combined = granularChunks.map(c => c.t).join('');
          setState(prev => ({
            ...prev,
            chunks: granularChunks,
            text: combined
          }));
        },
        customPrompt
      );
      
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err.message || "Refinement failed."
      }));
    }
  };

  const handleCopy = () => {
    if (!state.text) return;
    navigator.clipboard.writeText(state.text);
  };

  const handleClear = () => {
    setState(prev => ({
      ...prev,
      text: '',
      chunks: [],
      isLoading: false,
      error: null
    }));
  };

  const handleLoadDefaultText = () => {
    setState(prev => ({
      ...prev,
      text: DEFAULT_STARTER_TEXT,
      chunks: [],
      error: null,
      isLoading: false
    }));
  };

  const handleSignOut = () => {
    setState(prev => ({ ...prev, user: null }));
    localStorage.removeItem('refine_write_user');
    window.google?.accounts?.id?.disableAutoSelect();
  };

  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((prev) => !prev);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        toggleDarkMode();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleDarkMode]);

  if (!state.user) {
    return (
      <MotionConfig reducedMotion="never">
        <div className={`min-h-screen flex items-center justify-center p-4 transition-colors duration-500 ${isDarkMode ? 'bg-slate-950' : 'login-bg'}`}>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`rounded-[2rem] shadow-2xl p-10 max-w-md w-full text-center border transition-colors duration-500 ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-white/20'}`}
          >
          <div className="flex justify-end mb-2">
            <button
              onClick={toggleDarkMode}
              aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className={isDarkMode ? 'p-2 text-slate-200 hover:text-white transition-colors' : 'p-2 text-gray-500 hover:text-gray-900 transition-colors'}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={isDarkMode ? 'sun-login' : 'moon-login'}
                  initial={{ y: -10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 10, opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="inline-flex"
                >
                  {isDarkMode ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05 5.636 5.636m12.728 0L16.95 7.05M7.05 16.95l-1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3c0 .32-.02.63-.06.94a7 7 0 009.85 8.85z" />
                    </svg>
                  )}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
          <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-xl rotate-3">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <h1 className={`text-4xl font-black mb-2 tracking-tighter ${isDarkMode ? 'text-slate-100' : 'text-gray-900'}`}>RefineWrite</h1>
          <p className={`mb-6 text-lg leading-snug ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>Private Editorial Terminal</p>
          
          <div className={`mb-8 p-4 rounded-xl text-left ${isDarkMode ? 'bg-amber-900/20 border border-amber-700/60' : 'bg-amber-50 border border-amber-100'}`}>
            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-1 flex items-center gap-2">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
              Restricted Access
            </p>
            <p className={`text-[12px] ${isDarkMode ? 'text-amber-100' : 'text-amber-900'}`}>
              {MISSING_AUTH_CONFIG ? (
                <>Set <strong>GOOGLE_CLIENT_ID</strong> and <strong>ALLOWED_EMAIL</strong> in env variables.</>
              ) : (
                <>This application is exclusive to <strong>{ALLOWED_EMAIL}</strong>.</>
              )}
            </p>
            <div className={`mt-3 pt-3 border-t ${isDarkMode ? 'border-amber-700/50' : 'border-amber-200/70'}`}>
              <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-1">OAuth Setup Info</p>
              <p className={`text-[11px] break-all ${isDarkMode ? 'text-amber-100' : 'text-amber-900'}`}>
                Current origin: <strong>{networkInfo.origin || window.location.origin}</strong>
              </p>
              {networkInfo.localIPs.length > 0 && (
                <p className={`text-[11px] mt-1 break-all ${isDarkMode ? 'text-amber-100' : 'text-amber-900'}`}>
                  Local IP URL(s): <strong>{networkInfo.localIPs.map((ip) => `http://${ip}${networkInfo.port ? `:${networkInfo.port}` : ''}`).join(', ')}</strong>
                </p>
              )}
            </div>
          </div>

          {authError && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={`mb-6 p-4 rounded-xl text-xs font-medium ${isDarkMode ? 'bg-red-900/20 border border-red-700 text-red-200' : 'bg-red-50 border border-red-200 text-red-700'}`}
            >
              {authError}
            </motion.div>
          )}

          <div className="space-y-4">
            <div className="min-h-[50px] flex justify-center">
              {!MISSING_AUTH_CONFIG && <div id="googleBtn" className="w-full"></div>}
            </div>
          </div>
          </motion.div>
        </div>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="never">
      <div className={`min-h-screen flex flex-col items-center py-6 sm:py-10 px-4 transition-colors duration-500 ${isDarkMode ? 'bg-slate-950' : 'bg-gray-50'}`}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className={`w-full max-w-4xl rounded-2xl shadow-xl overflow-hidden flex flex-col min-h-[700px] transition-colors duration-500 ${isDarkMode ? 'bg-slate-900 border border-slate-700' : 'bg-white border border-gray-100'}`}
        >
        <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div>
              <h1 className="text-white font-bold text-xl leading-tight">RefineWrite</h1>
              <p className="text-indigo-100 text-[10px] uppercase font-bold tracking-wider">AI Editorial Terminal</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 pr-4">
              <div className="hidden sm:block text-right">
                <p className="text-white text-xs font-bold leading-none">{state.user.name}</p>
                <p className="text-indigo-200 text-[10px]">{state.user.email}</p>
              </div>
              <img src={state.user.picture} alt={state.user.name} className="w-8 h-8 rounded-full border border-white/50 bg-white" />
            </div>
            <div className="pl-4 border-l border-indigo-400/50">
              <button
                onClick={toggleDarkMode}
                aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                className="p-2 text-indigo-100 hover:text-white transition-colors"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={isDarkMode ? 'sun-main' : 'moon-main'}
                    initial={{ y: -10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 10, opacity: 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="inline-flex"
                  >
                    {isDarkMode ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05 5.636 5.636m12.728 0L16.95 7.05M7.05 16.95l-1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3c0 .32-.02.63-.06.94a7 7 0 009.85 8.85z" />
                      </svg>
                    )}
                  </motion.span>
                </AnimatePresence>
              </button>
            </div>
            <button onClick={handleSignOut} className="p-2 text-indigo-100 hover:text-white transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg></button>
          </div>
        </div>

        <Toolbar onRefine={handleRefine} onCopy={handleCopy} isLoading={state.isLoading} onClear={handleClear} onLoadDefaultText={handleLoadDefaultText} isDarkMode={isDarkMode} />

        <AnimatePresence>
          {state.error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className={`mx-6 mt-4 p-4 rounded-xl text-sm flex items-center gap-3 ${isDarkMode ? 'bg-red-900/20 border border-red-700 text-red-200' : 'bg-red-50 border border-red-100 text-red-700'}`}
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
              <span className="font-medium">{state.error}</span>
              <button onClick={() => setState(s => ({...s, error: null}))} className={`ml-auto ${isDarkMode ? 'text-red-300 hover:text-red-100' : 'text-red-400 hover:text-red-700'}`}>&times;</button>
            </motion.div>
          )}
        </AnimatePresence>

        <Editor text={state.text} chunks={state.chunks} onChange={handleTextChange} isLoading={state.isLoading} isDarkMode={isDarkMode} />

        <div className={`px-6 py-4 border-t text-[11px] flex justify-between items-center transition-colors duration-500 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-gray-50 border-gray-100 text-gray-500'}`}>
          <div className="flex gap-4"><span><strong>{state.text.length}</strong> chars</span><span><strong>{state.text.trim() === '' ? 0 : state.text.trim().split(/\s+/).length}</strong> words</span></div>
          <div className="flex gap-4 font-bold uppercase tracking-widest">
            {state.isLoading ? (
              <span className="flex items-center gap-1.5 text-indigo-600">
                <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full animate-ping"></span>
                Streaming AI...
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-green-600">
                <span className="w-2.5 h-2.5 bg-green-500 rounded-full"></span>
                Ready
              </span>
            )}
          </div>
        </div>
        </motion.div>
      </div>
    </MotionConfig>
  );
};

export default App;
