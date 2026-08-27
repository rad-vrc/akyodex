export function shouldInitializeNextServerSentry(
  nextRuntime: string | undefined,
  cloudflareDeployTarget: string | undefined
): boolean {
  return cloudflareDeployTarget !== 'workers' && (nextRuntime === 'nodejs' || nextRuntime === 'edge');
}
