"use client";

import { preload } from "react-dom";

export function CatalogPreload({ href }: { href: string }) {
  preload(href, {
    as: "fetch",
    crossOrigin: "anonymous",
    fetchPriority: "auto",
    type: "application/json",
  });
  return null;
}
