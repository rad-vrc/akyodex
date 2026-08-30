/**
 * 環境変数の型定義
 */

type MinimalR2BucketBinding = {
  put: (key: string, value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string, options?: {
    httpMetadata?: {
      contentType?: string;
    };
  }) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

type WorkerVersionMetadataBinding = {
  id: string;
  tag: string;
  timestamp: string;
};

declare global {
  interface CloudflareExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
  }

  namespace NodeJS {
    interface ProcessEnv {
      // Public環境変数
      NEXT_PUBLIC_SITE_URL: string;
      NEXT_PUBLIC_R2_BASE: string;
      NEXT_PUBLIC_REFERENCE_R2_BASE?: string;
      NEXT_PUBLIC_SENTRY_DSN?: string;

      // Server-side環境変数
      ADMIN_PASSWORD_OWNER?: string;
      ADMIN_PASSWORD_ADMIN?: string;
      SENTRY_DSN?: string;
      SENTRY_ORG?: string;
      SENTRY_PROJECT?: string;
      SENTRY_AUTH_TOKEN?: string;
      GITHUB_TOKEN?: string;
      GITHUB_REPO?: string;
      CLOUDFLARE_ACCOUNT_ID?: string;
      CLOUDFLARE_API_TOKEN?: string;
      
      // On-demand ISR revalidation
      REVALIDATE_SECRET?: string;
      
      // Phase 4: JSON data source toggle
      NEXT_PUBLIC_USE_JSON_DATA?: string;
    }
  }

  interface CloudflareEnv {
    AKYO_BUCKET?: MinimalR2BucketBinding;
    CF_VERSION_METADATA?: WorkerVersionMetadataBinding;
  }
}

export { };

