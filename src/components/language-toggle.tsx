'use client';

/**
 * Language Toggle Button Component
 *
 * Features:
 * - variant="floating": 画面右下の浮遊ボタン（sm 以上で表示）
 * - variant="inline": ヘッダー右上に並べる小さいボタン（スマホ用）
 * - Cycle through Japanese, English, and Korean
 * - Toggle order: ja → en → ko → ja
 * - Persistent via cookie
 * - Smooth transition
 */

import {
  DEFAULT_LANGUAGE,
  getNextLanguage,
  LANGUAGE_NAMES,
  LANGUAGE_TOGGLE_LABELS,
  SUPPORTED_LANGUAGES,
  t,
  type SupportedLanguage,
  type UITextKey,
} from '@/lib/i18n';
import { useEffect, useState } from 'react';

interface LanguageToggleProps {
  initialLang?: SupportedLanguage;
  className?: string;
  /** floating: 右下の浮遊ボタン（既定）。inline: ヘッダー内に置く非固定のボタン */
  variant?: 'floating' | 'inline';
}

export function LanguageToggle({
  initialLang = DEFAULT_LANGUAGE,
  className = '',
  variant = 'floating',
}: LanguageToggleProps) {
  const [currentLang, setCurrentLang] = useState<SupportedLanguage>(initialLang);
  const [isChanging, setIsChanging] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // SSR-safe values: use initialLang before mount to avoid hydration mismatch
  const effectiveLang = isMounted ? currentLang : initialLang;
  const nextLanguage = getNextLanguage(effectiveLang);
  const nextLanguageLabel = t(`languageNames.${nextLanguage}` as UITextKey, effectiveLang);

  // Read language from cookie on mount (client-side only)
  useEffect(() => {
    const cookieLang = document.cookie
      .split(';')
      .find((row) => row.trim().startsWith('AKYO_LANG='))
      ?.split('=')[1]
      ?.trim();

    if (cookieLang && SUPPORTED_LANGUAGES.includes(cookieLang as SupportedLanguage)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentLang(cookieLang as SupportedLanguage);
    }
    setIsMounted(true);
  }, []);

  const handleToggle = async () => {
    if (isChanging) return;

    setIsChanging(true);
    try {
      // Set cookie with immediate effect (Secure flag on HTTPS)
      const isSecure = window.location.protocol === 'https:';
      const secureFlag = isSecure ? '; Secure' : '';
      document.cookie = `AKYO_LANG=${nextLanguage}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax${secureFlag}`;

      // Update state immediately
      setCurrentLang(nextLanguage);

      // Hard reload for instant language change (faster than router.refresh())
      window.location.reload();
    } catch (error) {
      console.error('Failed to change language:', error);
      setIsChanging(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isChanging}
      className={`
        ${variant === 'inline' ? 'header-control-btn' : 'language-toggle-btn'}
        ${isChanging ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
    `}
      aria-label={t('language.switchTo', effectiveLang).replace('{lang}', nextLanguageLabel)}
      title={t('language.switchTo', effectiveLang).replace('{lang}', nextLanguageLabel)}
    >
      <span className="text-lg font-bold">{LANGUAGE_TOGGLE_LABELS[effectiveLang]}</span>
    </button>
  );
}
