'use client';

import { captureExceptionSafely } from '@/lib/sentry-browser';
import { isGoogleWrsServiceWorkerRejection } from '@/lib/service-worker-errors';
import { useEffect, useRef, useState } from 'react';

/**
 * Service Worker Registration Component
 * 
 * Registers the service worker and provides update notifications
 */
export function ServiceWorkerRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Check if service workers are supported
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      console.log('[SW] Service Workers not supported');
      return;
    }

    const reportServiceWorkerError = (
      phase: 'register' | 'update',
      error: unknown,
      additional: Record<string, unknown> = {}
    ) => {
      const sanitizeAdditionalSentryExtra = (
        rawAdditional: Record<string, unknown>
      ): Record<string, unknown> => {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rawAdditional)) {
          if (key === 'scope' && typeof value === 'string') {
            try {
              const parsedScope = new URL(value, window.location.origin);
              sanitized.scope = parsedScope.pathname || '/';
            } catch {
              sanitized.scope = '/';
            }
            continue;
          }

          // Defensive filtering: avoid forwarding URL/query/credential-like fields.
          if (/(^|_|-)(url|href|query|search|token|email)(_|-|$)/i.test(key)) {
            continue;
          }

          if (
            typeof value === 'string' &&
            (value.includes('://') || (value.includes('?') && (value.includes('=') || value.includes('&'))))
          ) {
            continue;
          }

          sanitized[key] = value;
        }

        return sanitized;
      };

      const normalizedError = error instanceof Error ? error : new Error(String(error));
      const message = normalizedError.message;
      const name = normalizedError.name;

      const isExpectedError =
        message.includes('Service Workers are not supported') ||
        message.includes('The operation is insecure') ||
        message.includes('Failed to register a ServiceWorker') ||
        name === 'SecurityError' ||
        (phase === 'register' && isGoogleWrsServiceWorkerRejection(normalizedError));

      if (isExpectedError) {
        return;
      }

      captureExceptionSafely(normalizedError, {
        level: 'error',
        tags: {
          area: 'service-worker',
          phase,
          online: String(navigator.onLine),
        },
        extra: {
          errorName: name,
          errorMessage: message,
          pathname: window.location.pathname,
          userAgent: navigator.userAgent,
          ...sanitizeAdditionalSentryExtra(additional),
        },
      });
    };

    const shouldIgnoreUpdateError = (error: unknown): boolean => {
      const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const isGenericNetworkError =
        message.includes('a bad http response code') || message.includes('failed to fetch');
      return (
        message.includes('failed to update a serviceworker') ||
        message.includes('the script resource is behind a redirect') ||
        (isOffline && isGenericNetworkError)
      );
    };

    // Register service worker
    const registerServiceWorker = async () => {
      try {
        console.log('[SW] Registering Service Worker...');
        const reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        setRegistration(reg);
        console.log('[SW] Service Worker registered:', reg.scope);

        // Check for updates on initial load
        void reg.update().catch((error) => {
          if (shouldIgnoreUpdateError(error)) {
            return;
          }
          console.error('[SW] Initial update check failed:', error);
          reportServiceWorkerError('update', error, { scope: reg.scope, stage: 'initial-check' });
        });

        // Listen for updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              console.log('[SW] New version available!');
              setUpdateAvailable(true);
            }
          });
        });

        // Check for updates every hour (ref で保持してクリーンアップ可能にする)
        updateIntervalRef.current = setInterval(() => {
          void reg.update().catch((error) => {
            if (shouldIgnoreUpdateError(error)) {
              return;
            }
            console.error('[SW] Scheduled update check failed:', error);
            reportServiceWorkerError('update', error, { scope: reg.scope, stage: 'scheduled-check' });
          });
        }, 60 * 60 * 1000);

      } catch (error) {
        // Log detailed error information
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[SW] Registration failed:', errorMessage);

        reportServiceWorkerError('register', error, {
          readyState: document.readyState,
        });
      }
    };

    // Register on load
    if (document.readyState === 'complete') {
      registerServiceWorker();
    } else {
      window.addEventListener('load', registerServiceWorker);
    }

    return () => {
      window.removeEventListener('load', registerServiceWorker);
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
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
