import * as Sentry from '@sentry/nextjs';
type SentryCaptureContext = NonNullable<
  Parameters<typeof Sentry.captureException>[1]
>;
type SentryMessageCaptureContext = NonNullable<
  Parameters<typeof Sentry.captureMessage>[1]
>;
type SentryDistributionOptions = NonNullable<
  Parameters<typeof Sentry.metrics.distribution>[2]
>;

type PendingEvent =
  | {
    type: 'exception';
    error: unknown;
    captureContext?: SentryCaptureContext;
    attempts: number;
  }
  | {
    type: 'message';
    message: string;
    captureContext?: SentryMessageCaptureContext;
    attempts: number;
  }
  | {
    type: 'distribution';
    name: string;
    value: number;
    options?: SentryDistributionOptions;
    attempts: number;
  };

const MAX_PENDING_EVENTS = 30;
const MAX_RETRY_ATTEMPTS = 10;
const RETRY_DELAY_MS = 500;
const HAS_BROWSER_SENTRY_DSN = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

let pendingEvents: PendingEvent[] = [];
let retryTimer: number | null = null;

function scheduleRetryFlush(): void {
  if (typeof window === 'undefined' || retryTimer) {
    return;
  }

  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    flushPendingEvents();
  }, RETRY_DELAY_MS);
}

function enqueuePendingEvent(event: PendingEvent): void {
  if (pendingEvents.length >= MAX_PENDING_EVENTS) {
    pendingEvents.shift();
  }
  pendingEvents.push(event);
  scheduleRetryFlush();
}

function flushPendingEvents(): void {
  // With @sentry/nextjs module imports, Sentry.captureException / captureMessage are normally callable
  // once HAS_BROWSER_SENTRY_DSN is true, so this retry queue (pendingEvents, pushRetry, scheduleRetryFlush)
  // is a defensive safeguard only and capped by MAX_RETRY_ATTEMPTS.
  if (!HAS_BROWSER_SENTRY_DSN) {
    pendingEvents = [];
    return;
  }

  if (pendingEvents.length === 0) {
    return;
  }

  if (!Sentry.getClient()) {
    pendingEvents = pendingEvents.flatMap((event) => {
      const attempts = event.attempts + 1;
      return attempts < MAX_RETRY_ATTEMPTS
        ? [{ ...event, attempts }]
        : [];
    });
    if (pendingEvents.length > 0) {
      scheduleRetryFlush();
    }
    return;
  }

  const nextQueue: PendingEvent[] = [];
  const pushRetry = (event: PendingEvent): void => {
    const attempts = event.attempts + 1;
    if (attempts < MAX_RETRY_ATTEMPTS) {
      nextQueue.push({ ...event, attempts });
    }
  };

  for (const event of pendingEvents) {
    try {
      if (event.type === 'exception') {
        Sentry.captureException(event.error, event.captureContext);
      } else if (event.type === 'message') {
        Sentry.captureMessage(event.message, event.captureContext);
      } else {
        Sentry.metrics.distribution(event.name, event.value, event.options);
      }
    } catch {
      pushRetry(event);
    }
  }

  pendingEvents = nextQueue;
  if (pendingEvents.length > 0) {
    scheduleRetryFlush();
  }
}

export function captureExceptionSafely(
  error: unknown,
  captureContext?: SentryCaptureContext
): void {
  if (!HAS_BROWSER_SENTRY_DSN) {
    return;
  }

  flushPendingEvents();

  try {
    Sentry.captureException(error, captureContext);
  } catch {
    enqueuePendingEvent({
      type: 'exception',
      error,
      captureContext,
      attempts: 1,
    });
  }
}

export function captureMessageSafely(
  message: string,
  captureContext?: SentryMessageCaptureContext
): void {
  if (!HAS_BROWSER_SENTRY_DSN) {
    return;
  }

  flushPendingEvents();

  try {
    Sentry.captureMessage(message, captureContext);
  } catch {
    enqueuePendingEvent({
      type: 'message',
      message,
      captureContext,
      attempts: 1,
    });
  }
}

export function captureDistributionSafely(
  name: string,
  value: number,
  options?: SentryDistributionOptions
): void {
  if (!HAS_BROWSER_SENTRY_DSN) {
    return;
  }

  flushPendingEvents();

  // A future delayed Sentry initialization must keep this queue window long
  // enough for INP values that finalize during an early pagehide.
  if (!Sentry.getClient()) {
    enqueuePendingEvent({
      type: 'distribution',
      name,
      value,
      options,
      attempts: 1,
    });
    return;
  }

  try {
    Sentry.metrics.distribution(name, value, options);
  } catch {
    enqueuePendingEvent({
      type: 'distribution',
      name,
      value,
      options,
      attempts: 1,
    });
  }
}
