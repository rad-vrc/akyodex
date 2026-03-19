/**
 * Props for the StructuredData component
 */
interface StructuredDataProps {
  /** Optional CSP nonce for script execution */
  nonce?: string;
}

/**
 * StructuredData Component
 * Renders JSON-LD structured data for SEO optimization (Schema.org).
 * Injects a script tag into the head or body with site-wide metadata.
 *
 * @param props - Component properties
 * @returns JSON-LD script element
 */
export function StructuredData({ nonce }: StructuredDataProps) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Akyoずかん',
    alternateName: 'Akyodex',
    url: 'https://akyodex.com',
    description: 'VRChatに潜むなぞ生物アバター「Akyo」を700体以上、そしてAkyo要素のあるワールドを50種類以上収録したAkyoコンテンツの図鑑サイト',
    inLanguage: ['ja-JP', 'en-US', 'ko-KR'],
    author: {
      '@type': 'Person',
      name: 'らど',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Akyodex',
      logo: {
        '@type': 'ImageObject',
        url: 'https://akyodex.com/images/akyodexIcon-512.png',
      },
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://akyodex.com/zukan?search={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <script
      id="website-structured-data"
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  );
}
