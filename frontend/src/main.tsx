import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { AuthProvider } from './contexts/AuthContext';
import App from './App';
import './index.css';

const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const SW_UPDATE_EVENT = 'pwa-update-available';
const SW_ACTIVATE_EVENT = 'pwa-activate-update';
let currentServiceWorkerRegistration: ServiceWorkerRegistration | null = null;
let reloadAfterServiceWorkerUpdate = false;

function notifyServiceWorkerUpdate() {
  window.dispatchEvent(new Event(SW_UPDATE_EVENT));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadAfterServiceWorkerUpdate) return;
    reloadAfterServiceWorkerUpdate = false;
    window.location.reload();
  });

  window.addEventListener(SW_ACTIVATE_EVENT, () => {
    const waiting = currentServiceWorkerRegistration?.waiting;
    if (!waiting) return;
    reloadAfterServiceWorkerUpdate = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        currentServiceWorkerRegistration = registration;
        if (registration.waiting) notifyServiceWorkerUpdate();

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              notifyServiceWorkerUpdate();
            }
          });
        });

        // Fuerza una comprobación al abrir la aplicación para detectar rápido
        // un deploy reciente en Railway.
        registration.update().catch(() => {/* silencioso */});
      })
      .catch(() => {/* silencioso */});
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
