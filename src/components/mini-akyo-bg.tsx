'use client';

/**
 * Mini Akyo Background Animation
 *
 * Floating mini Akyo avatars in the background - signature UX feature from original site
 * Port from js/mini-akyo-bg.js with complete feature parity:
 * - Golden ratio pseudo-random placement for visual balance
 * - Configurable density via URL param ?bgdensity=NN
 * - Prefers-reduced-motion support for accessibility
 * - Performance optimized with CSS animations and will-change
 * - Background density auto-adjusts based on viewport size
 * - Loads miniakyo.webp image from R2 with fallback cascade
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// Frequency boost (1.5x from original)
const FREQ_BOOST = 1.5;

// Image URL candidates (priority order)
const CANDIDATES = [
  // Production R2 direct
  'https://images.akyodex.com/miniakyo.webp',
  'https://images.akyodex.com/@miniakyo.webp',
  // R2 images/ subdirectory
  'https://images.akyodex.com/images/miniakyo.webp',
  'https://images.akyodex.com/images/@miniakyo.webp',
  // Relative (Pages/Local)
  '/images/miniakyo.webp',
  '/images/@miniakyo.webp',
];

// Golden ratio for low-discrepancy sequence
const PHI = 0.6180339887498949; // (sqrt(5)-1)/2
const CROSS_ORIGIN_PROBE_TIMEOUT_MS = 2000;

/** 値をクランプする純粋関数（コンポーネント外に配置して不要な再生成を防止） */
function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 画像の読み込み可否を確認するプローブ */
function probeImage(url: string, timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    let settled = false;

    const finalize = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = img.onerror = null;
      img.src = '';
      if (ok) { resolve(url); } else { reject(new Error('load failed')); }
    };

    const timer = setTimeout(() => finalize(false), timeout);
    img.decoding = 'async';
    img.loading = 'eager';
    img.onload = () => finalize(true);
    img.onerror = () => finalize(false);
    img.src = url;
  });
}

/** 同一オリジン URL かどうかを判定（cross-origin fetch による CORS エラー回避用） */
function isSameOriginUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

/** miniakyo.webp の URL をフォールバック付きで解決 */
async function resolveMiniAkyoUrl(): Promise<string | null> {
  let fallback: string | null = null;
  const ACCEPTABLE = new Set([200, 203, 204, 206, 304]);

  for (const path of CANDIDATES) {
    if (!fallback) fallback = path;

    // Cross-origin は fetch せず <img> プローブのみで判定する。
    // fetch すると CORS エラーが console に出るため。
    if (!isSameOriginUrl(path)) {
      try {
        await probeImage(path, CROSS_ORIGIN_PROBE_TIMEOUT_MS);
        return path;
      } catch {
        continue;
      }
    }

    try {
      const r = await fetch(path, { cache: 'no-cache' });
      if (r.ok || ACCEPTABLE.has(r.status) || (r.type === 'opaque' && !r.status)) {
        return path;
      }
      try { await probeImage(path); return path; } catch { /* next */ }
    } catch {
      try { await probeImage(path); return path; } catch { /* next */ }
    }
  }
  return fallback;
}

interface MiniAkyoProps {
  className?: string;
}

export function MiniAkyoBg({ className = '' }: MiniAkyoProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [density, setDensity] = useState<number>(0);
  const [seqSeed] = useState<number>(() => Math.random());
  const containerRef = useRef<HTMLDivElement>(null);
  const seqU = useRef<number>(seqSeed);
  const maintainTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resizeHandler = useRef<(() => void) | null>(null);
  const rafRef = useRef<number | null>(null);

  // OSの「アニメーション削減」が有効なら描画自体を行わない。
  // 以前は CSS で animation:none + opacity 0.08 にしていたが、ほぼ見えない要素を
  // 目標密度ぶん（最大42枚）抱えたまま setInterval が回り続けるだけだった。
  // このコンポーネントは dynamic(ssr:false) で読まれるため window は常に存在する。
  const [reducedMotion, setReducedMotion] = useState<boolean>(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Low-discrepancy sequence for balanced placement
  const nextUniform = useCallback(() => {
    seqU.current = (seqU.current + PHI) % 1;
    return seqU.current;
  }, []);

  // Spawn single mini Akyo element
  const spawnOne = useCallback((container: HTMLDivElement, url: string, uOverride?: number) => {
    const el = document.createElement('div');
    el.className = 'mini-akyo';

    const size = Math.round(64 + Math.random() * 96); // 64-160px
    const u = typeof uOverride === 'number' ? uOverride : nextUniform();
    const leftVW = clamp(u * 100, 2, 98);
    const duration = 18 + Math.random() * 14; // 18-32s
    const delay = Math.random() * 8; // 0-8s
    const opacity = 0.24 + Math.random() * 0.18; // 0.24-0.42
    const drift = Math.random() * 40 - 20;
    const rotate = Math.random() * 40 - 20;

    el.style.setProperty('--size', `${size}px`);
    el.style.setProperty('--left', `calc(${leftVW}vw + ${drift}px)`);
    el.style.setProperty('--opacity', String(opacity));
    el.style.setProperty('--duration', `${duration}s`);
    el.style.setProperty('--rotate', `${rotate}deg`);
    el.style.animationDuration = `${duration}s`;
    el.style.animationDelay = `${delay}s`;
    el.style.backgroundImage = `url("${url}")`;
    el.style.transform = `translateY(0) rotate(${rotate}deg)`;
    el.style.opacity = String(opacity);

    el.addEventListener('animationend', () => {
      el.remove();
    });

    container.appendChild(el);
  }, [nextUniform]);

  // Initialize background animation（一度だけ実行）
  useEffect(() => {
    const init = async () => {
      const container = containerRef.current;
      if (!container) return;

      // Resolve image URL (module-level pure function)
      const url = await resolveMiniAkyoUrl();
      if (!url) return;

      setImageUrl(url);

      // Calculate initial density
      const side = Math.sqrt(window.innerWidth * window.innerHeight);
      let base = Math.round(side / 95); // Larger screens get more density
      base = Math.min(28, Math.max(10, base));
      let initial = Math.round(base * FREQ_BOOST);
      initial = Math.min(Math.round(28 * FREQ_BOOST), Math.max(10, initial));

      // Check URL parameter for custom density
      try {
        const params = new URLSearchParams(window.location.search);
        const dens = parseInt(params.get('bgdensity') || '', 10);
        if (!isNaN(dens) && dens >= 6 && dens <= 50) {
          initial = dens;
        }
      } catch {
        // Ignore URL parsing errors
      }

      setDensity(initial);

      // Spawn initial elements with stratified placement
      for (let i = 0; i < initial; i++) {
        const u = (i + Math.random()) / initial;
        spawnOne(container, url, u);
      }

      const targetDensity = initial;

      // Maintain density with periodic spawning
      if (maintainTimer.current) clearInterval(maintainTimer.current);
      maintainTimer.current = setInterval(() => {
        if (!containerRef.current) return;
        const current = containerRef.current.children.length;
        const deficit = targetDensity - current;
        const spawnCount = deficit > 0 ? Math.min(5, Math.max(1, deficit)) : 0;
        for (let i = 0; i < spawnCount; i++) {
          spawnOne(containerRef.current, url);
        }
      }, Math.round(1600 / FREQ_BOOST));

      // Handle window resize
      if (resizeHandler.current) {
        window.removeEventListener('resize', resizeHandler.current);
      }
      resizeHandler.current = () => {
        if (!containerRef.current) return;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);

        rafRef.current = requestAnimationFrame(() => {
          if (!containerRef.current) return;
          const side = Math.sqrt(window.innerWidth * window.innerHeight);
          let base = Math.round(side / 95);
          base = Math.min(28, Math.max(10, base));
          let ideal = Math.round(base * FREQ_BOOST);
          ideal = Math.min(Math.round(28 * FREQ_BOOST), Math.max(10, ideal));

          // Honor ?bgdensity if present
          try {
            const params = new URLSearchParams(window.location.search);
            const dens = parseInt(params.get('bgdensity') || '', 10);
            if (!isNaN(dens) && dens >= 6 && dens <= 50) {
              ideal = dens;
            }
          } catch { /* ignore */ }

          const container = containerRef.current;
          while (container.children.length > ideal && container.firstElementChild) {
            container.removeChild(container.firstElementChild);
          }
          rafRef.current = null;
        });
      };
      window.addEventListener('resize', resizeHandler.current);
    };

    init();

    // Cleanup
    return () => {
      if (maintainTimer.current) {
        clearInterval(maintainTimer.current);
      }
      if (resizeHandler.current) {
        window.removeEventListener('resize', resizeHandler.current);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
    // reducedMotion が切り替わったら cleanup → 再init する。true になった側では
    // return null で container が消えるので init は何もしない（interval は cleanup で止まる）。
  }, [spawnOne, reducedMotion]);

  // フックはすべて上で呼び終えているので、ここでの早期returnは安全
  if (reducedMotion) return null;

  return (
    <>
      <style jsx global>{`
        #miniAkyoBg {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          pointer-events: none;
          z-index: 0;
        }

        .mini-akyo {
          position: absolute;
          bottom: -12%;
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          opacity: var(--opacity, 0.35);
          width: var(--size, 96px);
          height: var(--size, 96px);
          left: var(--left, 50vw);
          animation: akyo-float-up var(--duration, 22s) linear forwards;
          will-change: transform, opacity;
          filter: drop-shadow(0 3px 10px rgba(0, 0, 0, 0.35));
        }

        @keyframes akyo-float-up {
          0% {
            transform: translateY(0) rotate(var(--rotate, 0deg));
            opacity: var(--opacity, 0.35);
          }
          100% {
            transform: translateY(-120vh) rotate(calc(var(--rotate, 0deg) + 360deg));
            opacity: 0;
          }
        }

      `}</style>

      <div
        id="miniAkyoBg"
        ref={containerRef}
        aria-hidden="true"
        className={className}
        data-image-url={imageUrl}
        data-density={density}
      />
    </>
  );
}
