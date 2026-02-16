import { useEffect, useState } from 'react';

export interface NetworkInfo {
  origin: string;
  host: string;
  port: string;
  localIPs: string[];
}

const DEFAULT_NETWORK_INFO: NetworkInfo = {
  origin: window.location.origin,
  host: window.location.host,
  port: window.location.port,
  localIPs: [],
};

export const useNetworkInfo = () => {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo>(DEFAULT_NETWORK_INFO);

  useEffect(() => {
    let cancelled = false;

    const loadNetworkInfo = async () => {
      try {
        const response = await fetch('/api/network-info');
        if (!response.ok || cancelled) {
          return;
        }

        const data = await response.json();
        if (cancelled) {
          return;
        }

        setNetworkInfo({
          origin: data?.origin || window.location.origin,
          host: data?.host || window.location.host,
          port: data?.port || window.location.port,
          localIPs: Array.isArray(data?.localIPs) ? data.localIPs : [],
        });
      } catch {
        // OAuth helper only. Keep fallback values.
      }
    };

    loadNetworkInfo();

    return () => {
      cancelled = true;
    };
  }, []);

  return networkInfo;
};
