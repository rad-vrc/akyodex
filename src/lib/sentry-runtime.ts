export function shouldInitializeNextServerSentry(
  nextRuntime: string | undefined,
  cloudflareDeployTarget: string | undefined
): boolean {
  const isCloudflareTarget =
    cloudflareDeployTarget === 'pages' || cloudflareDeployTarget === 'workers';

  return !isCloudflareTarget && (nextRuntime === 'nodejs' || nextRuntime === 'edge');
}

export function shouldApplyNextSentryBuildConfig(
  cloudflareDeployTarget: string | undefined,
  organization: string | undefined,
  project: string | undefined,
  authToken: string | undefined
): boolean {
  const isCloudflareTarget =
    cloudflareDeployTarget === 'pages' || cloudflareDeployTarget === 'workers';

  return !isCloudflareTarget && Boolean(organization && project && authToken);
}
