#!/usr/bin/env bash

set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${WORKERS_NAME:?WORKERS_NAME is required}"

CLOUDFLARE_ZONE_NAME="${CLOUDFLARE_ZONE_NAME:-akyodex.com}"
CLOUDFLARE_WORKER_ROUTE="${CLOUDFLARE_WORKER_ROUTE:-akyodex.com/*}"

cloudflare_api() {
  curl --silent --show-error --fail-with-body \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    --header "Content-Type: application/json" \
    "$@"
}

zone_response="$(cloudflare_api \
  --get \
  --data-urlencode "name=${CLOUDFLARE_ZONE_NAME}" \
  --data-urlencode "account.id=${CLOUDFLARE_ACCOUNT_ID}" \
  "https://api.cloudflare.com/client/v4/zones")"

zone_id="$(jq -er '
  if .success != true then
    error("Cloudflare zone lookup failed")
  elif (.result | length) != 1 then
    error("Cloudflare zone lookup did not return exactly one zone")
  else
    .result[0].id
  end
' <<<"${zone_response}")"

routes_response="$(cloudflare_api \
  "https://api.cloudflare.com/client/v4/zones/${zone_id}/workers/routes")"

jq -e '.success == true' <<<"${routes_response}" >/dev/null

route_count="$(jq \
  --arg pattern "${CLOUDFLARE_WORKER_ROUTE}" \
  --arg script "${WORKERS_NAME}" \
  '[.result[] | select(.pattern == $pattern and .script == $script)] | length' \
  <<<"${routes_response}")"

if [ "${route_count}" -eq 0 ]; then
  echo "Worker route ${CLOUDFLARE_WORKER_ROUTE} is already absent."
  exit 0
fi

if [ "${route_count}" -ne 1 ]; then
  echo "::error::Expected one matching Worker route, found ${route_count}."
  exit 1
fi

route_id="$(jq -er \
  --arg pattern "${CLOUDFLARE_WORKER_ROUTE}" \
  --arg script "${WORKERS_NAME}" \
  '.result[] | select(.pattern == $pattern and .script == $script) | .id' \
  <<<"${routes_response}")"

delete_response="$(cloudflare_api \
  --request DELETE \
  "https://api.cloudflare.com/client/v4/zones/${zone_id}/workers/routes/${route_id}")"

jq -e '.success == true' <<<"${delete_response}" >/dev/null
echo "Removed Worker route ${CLOUDFLARE_WORKER_ROUTE} from ${WORKERS_NAME}."
