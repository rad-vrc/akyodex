export function shouldInitializeNextServerSentry(
  nextRuntime: string | undefined,
  cloudflareDeployTarget: string | undefined
): boolean {
  return cloudflareDeployTarget !== 'workers' && (nextRuntime === 'nodejs' || nextRuntime === 'edge');
}

export function shouldApplyNextSentryBuildConfig(
  cloudflareDeployTarget: string | undefined,
  organization: string | undefined,
  project: string | undefined,
  authToken: string | undefined
): boolean {
  return cloudflareDeployTarget !== 'workers' && Boolean(organization && project && authToken);
}
