
import React, { useState, useCallback, useEffect, useRef } from 'react';
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

interface DebugInfo {
  startedAt: string | null;
  mode: RefinementType | null;
  textLength: number;
  customInstructionLength: number;
  responseStatus: number | null;
  status: 'idle' | 'running' | 'success' | 'error';
  sseEvents: number;
  chunkUpdates: number;
  chunkCount: number;
  lastEvent: string;
  lastError: string | null;
  lastResponseBody: string;
}

const App: React.FC = () => {
  const [state, setState] = useState<EditorState>({
    text: '',
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
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    startedAt: null,
    mode: null,
    textLength: 0,
    customInstructionLength: 0,
    responseStatus: null,
    status: 'idle',
    sseEvents: 0,
    chunkUpdates: 0,
    chunkCount: 0,
    lastEvent: 'none',
    lastError: null,
    lastResponseBody: '',
  });
  const streamChunksRef = useRef<RefinementChunk[]>([]);

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

  const handleTextChange = useCallback((newText: string) => {
    setState(prev => ({ ...prev, text: newText }));
  }, []);

  const handleRefine = async (type: RefinementType, customPrompt?: string) => {
    if (!state.text.trim()) {
      setState(prev => ({ ...prev, error: "Please enter some text first." }));
      return;
    }

    setDebugInfo({
      startedAt: new Date().toISOString(),
      mode: type,
      textLength: state.text.length,
      customInstructionLength: customPrompt?.length || 0,
      responseStatus: null,
      status: 'running',
      sseEvents: 0,
      chunkUpdates: 0,
      chunkCount: 0,
      lastEvent: 'request_start',
      lastError: null,
      lastResponseBody: '',
    });

    setState(prev => ({ ...prev, isLoading: true, error: null, chunks: [] }));
    streamChunksRef.current = [];
    
    try {
      await refineTextStream(
        state.text, 
        type, 
        (incomingChunks) => {
          streamChunksRef.current = incomingChunks;
          const combined = incomingChunks.map(c => c.t).join('');
          setState(prev => ({
            ...prev,
            chunks: incomingChunks,
            text: combined
          }));
        },
        customPrompt,
        (event, payload) => {
          setDebugInfo(prev => {
            const next: DebugInfo = { ...prev, lastEvent: event };

            if (event === 'response_status' && payload && typeof payload === 'object') {
              next.responseStatus = (payload as { status?: number }).status ?? null;
            }

            if (event === 'sse_event') {
              next.sseEvents += 1;
            }

            if (event === 'chunk_update' && payload && typeof payload === 'object') {
              next.chunkUpdates += 1;
              const typedPayload = payload as { chunkCount?: number; chunks?: RefinementChunk[] };
              next.chunkCount = typedPayload.chunkCount ?? next.chunkCount;
              if (Array.isArray(typedPayload.chunks)) {
                next.lastResponseBody = JSON.stringify(typedPayload.chunks, null, 2);
              }
            }

            if (event === 'done') {
              next.status = 'success';
            }

            if (event === 'client_error') {
              next.status = 'error';
              const msg = payload && typeof payload === 'object' ? (payload as { message?: string }).message : undefined;
              next.lastError = msg || 'Unknown client error';
            }

            return next;
          });
        }
      );
      
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err.message || "Refinement failed."
      }));
      setDebugInfo(prev => ({
        ...prev,
        status: 'error',
        lastEvent: 'catch_error',
        lastError: err.message || "Refinement failed."
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

  const handleSignOut = () => {
    setState(prev => ({ ...prev, user: null }));
    localStorage.removeItem('refine_write_user');
    window.google?.accounts?.id?.disableAutoSelect();
  };

  if (!state.user) {
    return (
      <div className="min-h-screen login-bg flex items-center justify-center p-4">
        <div className="bg-white rounded-[2rem] shadow-2xl p-10 max-w-md w-full text-center border border-white/20">
          <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-xl rotate-3">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <h1 className="text-4xl font-black text-gray-900 mb-2 tracking-tighter">RefineWrite</h1>
          <p className="text-gray-500 mb-6 text-lg leading-snug">Private Editorial Terminal</p>
          
          <div className="mb-8 p-4 bg-amber-50 border border-amber-100 rounded-xl text-left">
            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-1 flex items-center gap-2">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
              Restricted Access
            </p>
            <p className="text-[12px] text-amber-900">
              {MISSING_AUTH_CONFIG ? (
                <>Set <strong>GOOGLE_CLIENT_ID</strong> and <strong>ALLOWED_EMAIL</strong> in env variables.</>
              ) : (
                <>This application is exclusive to <strong>{ALLOWED_EMAIL}</strong>.</>
              )}
            </p>
            <div className="mt-3 pt-3 border-t border-amber-200/70">
              <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-1">OAuth Setup Info</p>
              <p className="text-[11px] text-amber-900 break-all">
                Current origin: <strong>{networkInfo.origin || window.location.origin}</strong>
              </p>
              {networkInfo.localIPs.length > 0 && (
                <p className="text-[11px] text-amber-900 mt-1 break-all">
                  Local IP URL(s): <strong>{networkInfo.localIPs.map((ip) => `http://${ip}${networkInfo.port ? `:${networkInfo.port}` : ''}`).join(', ')}</strong>
                </p>
              )}
            </div>
          </div>

          {authError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-medium">
              {authError}
            </div>
          )}

          <div className="space-y-4">
            <div className="min-h-[50px] flex justify-center">
              {!MISSING_AUTH_CONFIG && <div id="googleBtn" className="w-full"></div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-6 sm:py-10 px-4">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col border border-gray-100 min-h-[700px]">
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
            <div className="flex items-center gap-3 pr-4 border-r border-indigo-400/50">
              <img src={state.user.picture} alt={state.user.name} className="w-8 h-8 rounded-full border border-white/50 bg-white" />
              <div className="hidden sm:block">
                <p className="text-white text-xs font-bold leading-none">{state.user.name}</p>
                <p className="text-indigo-200 text-[10px]">{state.user.email}</p>
              </div>
            </div>
            <button onClick={handleSignOut} className="p-2 text-indigo-100 hover:text-white transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg></button>
          </div>
        </div>

        <Toolbar onRefine={handleRefine} onCopy={handleCopy} isLoading={state.isLoading} onClear={handleClear} />

        {state.error && (
          <div className="mx-6 mt-4 p-4 bg-red-50 border border-red-100 text-red-700 rounded-xl text-sm flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
            <span className="font-medium">{state.error}</span>
            <button onClick={() => setState(s => ({...s, error: null}))} className="ml-auto text-red-400 hover:text-red-700">&times;</button>
          </div>
        )}

        <Editor text={state.text} chunks={state.chunks} onChange={handleTextChange} isLoading={state.isLoading} />

        <div className="mx-6 mt-4 p-4 bg-slate-900 text-slate-100 rounded-xl border border-slate-700 text-xs font-mono">
          <p className="text-slate-300 uppercase tracking-widest text-[10px] mb-2">Debug</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-4">
            <p>Status: <strong>{debugInfo.status}</strong></p>
            <p>Mode: <strong>{debugInfo.mode || '-'}</strong></p>
            <p>Response status: <strong>{debugInfo.responseStatus ?? '-'}</strong></p>
            <p>Last event: <strong>{debugInfo.lastEvent}</strong></p>
            <p>SSE events: <strong>{debugInfo.sseEvents}</strong></p>
            <p>Chunk updates: <strong>{debugInfo.chunkUpdates}</strong></p>
            <p>Chunk count: <strong>{debugInfo.chunkCount}</strong></p>
            <p>Text length: <strong>{debugInfo.textLength}</strong></p>
            <p>Custom prompt length: <strong>{debugInfo.customInstructionLength}</strong></p>
            <p>Started at: <strong>{debugInfo.startedAt || '-'}</strong></p>
          </div>
          {debugInfo.lastError && (
            <p className="mt-2 text-red-300 break-words">Last error: <strong>{debugInfo.lastError}</strong></p>
          )}
          <div className="mt-2">
            <p className="text-slate-300 uppercase tracking-widest text-[10px] mb-1">Last Response Body</p>
            <pre className="bg-slate-950/70 border border-slate-700 rounded p-2 text-[11px] overflow-x-auto max-h-40">
              {debugInfo.lastResponseBody || '(no chunks received yet)'}
            </pre>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 flex justify-between items-center">
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
      </div>
    </div>
  );
};

export default App;
