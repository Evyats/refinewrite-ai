import { useEffect, useState } from 'react';

export type OpenAiStatusState = 'checking' | 'ready' | 'unavailable';

interface OpenAiStatusResponse {
  ready?: boolean;
  message?: string;
}

export const useOpenAiStatus = () => {
  const [status, setStatus] = useState<OpenAiStatusState>('checking');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const log = (stage: string, details?: unknown) => {
      if (details !== undefined) {
        console.info(`[client:openai-status:${requestId}] ${stage}`, details);
        return;
      }
      console.info(`[client:openai-status:${requestId}] ${stage}`);
    };

    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const checkStatusOnce = async (): Promise<boolean> => {
      setStatus('checking');
      setStatusMessage(null);
      log('request_start');

      try {
        const response = await fetch('/api/openai-status');
        log('response_received', {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
        });
        if (!response.ok) {
          if (!cancelled) {
            setStatus('unavailable');
            setStatusMessage(`OpenAI check failed (${response.status}).`);
          }
          log('response_not_ok');
          return false;
        }

        const payload = (await response.json()) as OpenAiStatusResponse;
        log('response_payload', payload);
        if (cancelled) {
          return false;
        }

        if (payload.ready) {
          setStatus('ready');
          setStatusMessage(null);
          return true;
        }

        setStatus('unavailable');
        setStatusMessage(payload.message || 'OpenAI integration is unavailable.');
        return false;
      } catch (error) {
        if (!cancelled) {
          setStatus('unavailable');
          setStatusMessage(error instanceof Error ? error.message : 'OpenAI integration check failed.');
        }
        log('request_exception', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        return false;
      }
    };

    const run = async () => {
      // Retry a few times on startup to avoid false negatives from transient network hiccups.
      const attempts = [0, 1000, 2000];
      for (let i = 0; i < attempts.length; i += 1) {
        if (attempts[i] > 0) {
          await sleep(attempts[i]);
        }
        const ok = await checkStatusOnce();
        if (ok || cancelled) {
          break;
        }
      }
    };

    run();

    const intervalId = window.setInterval(() => {
      run();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const markReady = () => {
    setStatus('ready');
    setStatusMessage(null);
  };

  return { status, statusMessage, markReady };
};
