export function isGoogleWrsServiceWorkerRejection(error: unknown): boolean {
  const errorRecord =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : null;
  const message =
    error instanceof Error ? error.message : String(errorRecord?.message ?? error);
  const stack =
    error instanceof Error
      ? error.stack
      : typeof errorRecord?.stack === "string"
        ? errorRecord.stack
        : undefined;

  return (
    message.trim().toLowerCase() === "rejected" &&
    stack?.includes("wrsParams.serviceWorkers") === true
  );
}
