import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

const CHUNK_RECOVERY_TS_KEY = 'evs_chunk_recovery_ts';

const isDynamicChunkError = (msg: string): boolean => {
  const m = String(msg || '').toLowerCase();
  return (
    m.includes('failed to fetch dynamically imported module') ||
    m.includes('importing a module script failed') ||
    m.includes('loading chunk') ||
    m.includes('chunkloaderror') ||
    m.includes('error loading dynamically imported module') ||
    m.includes('unable to preload css')
  );
};

async function clearCachesAndReload(hardResetUrl?: string) {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister().catch(() => {})));
    }
    if ('caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((k) => window.caches.delete(k).catch(() => {})));
    }
    try {
      await fetch('/index.html', { cache: 'reload' });
    } catch {}
  } catch {}

  if (hardResetUrl) {
    window.location.href = hardResetUrl;
  } else {
    window.location.reload();
  }
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State;
  public props: Props;

  constructor(props: Props) {
    super(props);
    this.props = props;
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message || 'अज्ञात त्रुटि' };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App Runtime Error:', error, errorInfo);
    const msg = error?.message || '';
    if (typeof window !== 'undefined' && isDynamicChunkError(msg)) {
      try {
        const lastAttempt = Number(sessionStorage.getItem(CHUNK_RECOVERY_TS_KEY) || '0');
        if (!lastAttempt || Date.now() - lastAttempt > 15000) {
          sessionStorage.setItem(CHUNK_RECOVERY_TS_KEY, String(Date.now()));
          clearCachesAndReload();
        }
      } catch {}
    }
  }

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      clearCachesAndReload();
    }
  };

  private handleClearAndReset = () => {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.clear();
      } catch {}
      clearCachesAndReload('/');
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0c2340] text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-slate-900/90 border border-slate-700/80 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-3xl font-black mx-auto shadow-lg shadow-amber-400/20">
              <i className="fa-solid fa-school"></i>
            </div>

            <div className="space-y-2">
              <h1 className="text-xl sm:text-2xl font-black text-white">
                ई.वी.एस. पब्लिक स्कूल
              </h1>
              <p className="text-xs text-amber-300 font-bold uppercase tracking-wider">
                पोर्टल पुनः लोड करें
              </p>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                ब्राउज़र या नेटवर्क के कारण ऐप लोड होने में अस्थायी समस्या आई है। कृपया नीचे दिए गए बटन पर टैप करके ऐप को पुनः लोड करें।
              </p>
            </div>

            {this.state.errorMessage && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-left font-mono text-[11px] text-slate-400 max-h-24 overflow-y-auto">
                त्रुटि: {this.state.errorMessage}
              </div>
            )}

            <div className="flex flex-col gap-2.5 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm transition-all shadow-md active:scale-98 cursor-pointer flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-rotate-right"></i>
                <span>ऐप पुनः लोड करें (Reload App)</span>
              </button>

              <button
                type="button"
                onClick={this.handleClearAndReset}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-all border border-slate-700 active:scale-98 cursor-pointer flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-broom"></i>
                <span>कैश साफ़ करके रीस्टार्ट करें</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
