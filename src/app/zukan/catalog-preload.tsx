"use client";

import { preconnect, preload } from "react-dom";

const R2_ORIGIN = "https://images.akyodex.com";

export function CatalogPreload({ href }: { href: string }) {
  preconnect(R2_ORIGIN);
  preload(href, {
    as: "fetch",
    crossOrigin: "anonymous",
    fetchPriority: "high",
    type: "application/json",
  });
  return null;
}
