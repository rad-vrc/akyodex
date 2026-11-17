function diagnostic(value, secrets = []) {
  let text = String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '');
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[redacted]');
  return text
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted]')
    .replace(/authorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, 'authorization=[redacted]')
    .replace(/\bbearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(x-amz-security-token|x-revalidate-secret|secretaccesskey|secret_access_key|sessiontoken|session_token|signature|credential|password|token)["']?\s*[:=]\s*["']?[^"'\s,;]+/gi, '$1=[redacted]')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .slice(0, 1200);
}

module.exports = { diagnostic };
