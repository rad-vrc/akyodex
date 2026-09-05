"use client";

import { useEffect, useState, type ComponentProps } from "react";
import type { AkyoDetailModal } from "./akyo-detail-modal";

type ModalComponent = typeof AkyoDetailModal;

export function DeferredAkyoDetailModal(props: ComponentProps<ModalComponent>) {
  const { isOpen, onClose } = props;
  const [Modal, setModal] = useState<ModalComponent | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    if (!isOpen || Modal) return;
    let disposed = false;

    // Resolve the module before rendering it, avoiding Suspense's reveal delay.
    // Image I/O stays in the committed viewer; this does not preload any image.
    void import("./akyo-detail-modal").then(
      ({ AkyoDetailModal }) => {
        if (!disposed) setModal(() => AkyoDetailModal);
      },
      (error: unknown) => {
        if (!disposed) {
          setLoadError(error instanceof Error ? error : new Error("Failed to load detail modal", { cause: error }));
        }
      },
    );

    return () => { disposed = true; };
  }, [isOpen, Modal]);

  useEffect(() => {
    if (!isOpen || Modal) return;
    const cancelPendingOpen = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", cancelPendingOpen);
    return () => document.removeEventListener("keydown", cancelPendingOpen);
  }, [isOpen, Modal, onClose]);

  // Preserve the route error boundary instead of silently failing to open.
  if (loadError) throw loadError;
  return Modal ? <Modal {...props} /> : null;
}
