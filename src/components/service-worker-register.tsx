'use client';

import { captureExceptionSafely } from '@/lib/sentry-browser';
import {
  isExpectedServiceWorkerError,
  runServiceWorkerRegistration,
  sanitizeServiceWorkerExtra,
  type ServiceWorkerPhase,
} from '@/lib/service-worker-registration';
import { useEffect, useRef, useState } from 'react';

/**
 * Service Worker Registration Component
 *
 * Registers the service worker and provides update notifications.
 * 登録の中身は src/lib/service-worker-registration.ts（純粋ロジック）にあり、
 * ここでは DOM・Sentry・React state との配線だけを行う。
 */
export function ServiceWorkerRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const updateIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    // Check if service workers are supported
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      console.log('[SW] Service Workers not supported');
      return;
    }

    // アンマウント後に遅れて register() が完了しても配線しないための失効フラグ
    let disposed = false;

    const reportServiceWorkerError = (
      phase: ServiceWorkerPhase,
      error: unknown,
      additional: Record<string, unknown> = {}
    ) => {
      if (isExpectedServiceWorkerError(phase, error)) {
        return;
      }

      const normalizedError = error instanceof Error ? error : new Error(String(error));
      captureExceptionSafely(normalizedError, {
        level: 'error',
        tags: {
          area: 'service-worker',
          phase,
          online: String(navigator.onLine),
        },
        extra: {
          errorName: normalizedError.name,
          errorMessage: normalizedError.message,
          pathname: window.location.pathname,
          userAgent: navigator.userAgent,
          ...sanitizeServiceWorkerExtra(additional, window.location.origin),
        },
      });
    };

    // Register service worker
    const registerServiceWorker = () => {
      void runServiceWorkerRegistration<ServiceWorkerRegistration>({
        register: () => navigator.serviceWorker.register('/sw.js', { scope: '/' }),
        hasController: () => Boolean(navigator.serviceWorker.controller),
        isDisposed: () => disposed,
        isOnline: () => navigator.onLine,
        readyState: () => document.readyState,
        onRegistered: setRegistration,
        onUpdateAvailable: () => setUpdateAvailable(true),
        onIntervalCreated: (id) => {
          updateIntervalRef.current = id;
        },
        reportError: reportServiceWorkerError,
        setInterval: (callback, ms) => window.setInterval(callback, ms),
      });
    };

    // Register on load
    if (document.readyState === 'complete') {
      registerServiceWorker();
    } else {
      window.addEventListener('load', registerServiceWorker);
    }

    return () => {
      disposed = true;
      window.removeEventListener('load', registerServiceWorker);
      if (updateIntervalRef.current !== null) {
        window.clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
    };
  }, []);

  // Handle update click
  const handleUpdate = () => {
    if (!registration || !registration.waiting) return;

    // Tell the waiting service worker to activate
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });

    // Reload the page when new service worker takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  };

  // Update notification UI
  if (!updateAvailable) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] max-w-sm bg-white rounded-lg shadow-2xl border-2 border-orange-500 p-4 animate-slide-up"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-full flex items-center justify-center">
          <svg
            className="w-6 h-6 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">
            新しいバージョンが利用可能です
          </h3>
          <p className="text-xs text-gray-600 mb-3">
            最新の機能と改善を利用するには、更新してください。
          </p>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUpdate}
              className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-medium py-2 px-4 rounded-lg hover:opacity-90 transition-opacity"
            >
              今すぐ更新
            </button>
            <button
              type="button"
              onClick={() => setUpdateAvailable(false)}
              className="px-3 text-gray-500 hover:text-gray-700 transition-colors text-sm"
              aria-label="閉じる"
            >
              後で
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
