'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { needsReducedEffects } from '@/lib/rendering-capability';

let initialized = false;
let reduced = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getSnapshot = () => reduced;
const getServerSnapshot = () => false;

export function useReducedEffects() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function RenderingMode() {
  useEffect(() => {
    if (initialized) return;
    initialized = true;
    reduced = needsReducedEffects();
    document.documentElement.dataset.reducedEffects = String(reduced);
    listeners.forEach(listener => listener());
  }, []);
  return null;
}
