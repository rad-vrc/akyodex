import { DEFAULT_LANGUAGE, detectLanguageFromHeader, isValidLanguage, t, type SupportedLanguage } from '@/lib/i18n';
import { cookies, headers } from 'next/headers';
import Image from 'next/image';
import { LoadingAnnouncement } from './loading-announcement';

const LOGO_BY_LANG: Record<SupportedLanguage, string> = {
  ja: '/images/logo-mobile.webp',
  en: '/images/logo-US-mobile.webp',
  ko: '/images/logo-KO-mobile.webp',
};

export function ZukanLoadingView({ lang }: { lang: SupportedLanguage }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <h1 className="sr-only">{t('page.title', lang)}</h1>
      <Image
        src={LOGO_BY_LANG[lang]}
        alt={t('logo.alt', lang)}
        width={454}
        height={70}
        priority
        unoptimized
        sizes="(max-width: 640px) 260px, 454px"
        className="h-10 w-auto sm:h-12"
      />
      <LoadingAnnouncement text={t('loading.text', lang)} />
    </div>
  );
}

export default async function ZukanLoading() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLang = cookieStore.get('AKYO_LANG')?.value;
  const lang: SupportedLanguage =
    cookieLang && isValidLanguage(cookieLang)
      ? cookieLang
      : detectLanguageFromHeader(headerStore.get('accept-language')) || DEFAULT_LANGUAGE;

  return <ZukanLoadingView lang={lang} />;
}
