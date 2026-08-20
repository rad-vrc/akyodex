export function isGoogleWrsServiceWorkerRejection(error: Error): boolean {
  return (
    error.message.trim().toLowerCase() === "rejected" &&
    error.stack?.includes("wrsParams.serviceWorkers") === true
  );
}
