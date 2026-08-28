'use client';

import {
  captureDistributionSafely,
  captureMessageSafely,
} from '@/lib/sentry-browser';
import {
  createWebVitalDistribution,
  getWorkerVersionFromNavigation,
} from '@/lib/web-vitals-reporting';
import { useReportWebVitals } from 'next/web-vitals';

/**
 * WebVitals Component
 * Reports LCP, INP, and CLS distributions plus poor-metric alerts to Sentry.
 * 
 * @returns null (behavior-only component)
 */
type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];

const reportWebVitals: ReportWebVitalsCallback = (metric) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Web Vitals]', {
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigationType: metric.navigationType,
    });
    return;
  }

  const distribution = createWebVitalDistribution(metric, {
    language: document.documentElement.lang,
    pathname: window.location.pathname,
    workerVersion: getWorkerVersionFromNavigation(performance),
  });
  if (distribution) {
    captureDistributionSafely(distribution.name, distribution.value, {
      unit: distribution.unit,
      attributes: distribution.attributes,
    });
  }

  if (metric.rating === 'poor') {
    captureMessageSafely(`Web Vitals degraded: ${metric.name}`, {
      level: 'warning',
      tags: {
        web_vital: metric.name,
        rating: metric.rating,
      },
      fingerprint: ['web-vitals', metric.name, metric.rating],
      extra: {
        value: metric.value,
        navigationType: metric.navigationType,
      },
    });
  }
};

export function WebVitals() {
  useReportWebVitals(reportWebVitals);

  return null;
}
