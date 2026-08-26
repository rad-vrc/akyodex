/**
 * Cloudflare Workers runtime extensions
 *
 * Type augmentations for APIs available in the Cloudflare Workers
 * runtime but not included in the standard Web Crypto TypeScript
 * definitions (lib.dom / lib.webworker).
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#timingsafeequal
 */

interface SubtleCrypto {
  /**
   * Compares two ArrayBuffer or ArrayBufferView values in constant time.
   *
   * Available in the Cloudflare Workers runtime as an extension to the
   * standard Web Crypto API.  Both parameters must have the same byte
   * length; otherwise the function throws a RangeError.
   */
  timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
}

interface CloudflareImageTransformOptions {
  width?: number;
  fit?: "scale-down";
  quality?: number;
  format?: "avif" | "webp";
}

interface RequestInit {
  /** Cloudflare Workers fetch extensions used by Images Transformations. */
  cf?: {
    image?: CloudflareImageTransformOptions;
  };
}
