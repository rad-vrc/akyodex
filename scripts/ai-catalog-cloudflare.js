const { setTimeout: sleep } = require('node:timers/promises');
const { EMBEDDING_MODEL, embeddingReservation, reserveBudget, finishBudget } = require('./ai-budget');

class CompletedRequestError extends Error {}

function createCloudflareClient({ accountId, token, databaseId, indexName, fetchImpl = fetch,
  retryDelayMs = 1000, timeoutMs = 30_000 }) {
  if (!accountId || !token || !databaseId || !indexName) throw new Error('Cloudflare search sync credentials/configuration are missing');
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
  const index = `/vectorize/v2/indexes/${encodeURIComponent(indexName)}`;
  async function request(path, body, method = 'POST', retries = 3) {
    for (let attempt = 0; ; attempt++) {
      let response;
      let payload;
      try {
        response = await fetchImpl(`${base}${path}`, {
          method, headers: { Authorization: `Bearer ${token}`, ...(body instanceof FormData || body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
        });
        // Separate transport/body failure from a complete but unusable response.
        const contents = await response.text();
        try { payload = JSON.parse(contents); }
        catch { throw new CompletedRequestError(`Cloudflare API failed (HTTP ${response.status}; invalid JSON)`); }
      } catch (error) {
        if (error instanceof CompletedRequestError && attempt >= retries) throw error;
        if (response && response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`Cloudflare API failed (HTTP ${response.status})`);
        }
        if (attempt >= retries) throw new Error('Cloudflare request failed or timed out');
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
      if (response.ok && payload?.success === true) return payload.result;
      if (attempt < retries && (response.status === 429 || response.status >= 500)) {
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
      // Do not log raw server bodies, request headers, credentials or catalog text.
      throw new CompletedRequestError(`Cloudflare API failed (HTTP ${response.status}; codes ${(Array.isArray(payload?.errors) ? payload.errors : []).map(e => e.code).join(',')})`);
    }
  }
  async function mutation(path, body) {
    const result = await request(`${index}${path}`, body);
    if (!result?.mutationId) throw new Error('Vectorize mutation was not acknowledged');
  }
  async function query(sql, params = []) {
    const result = await request(`/d1/database/${encodeURIComponent(databaseId)}/query`, { sql, params });
    if (!Array.isArray(result) || result.length !== 1 || result[0].success !== true || !Array.isArray(result[0].results)) {
      throw new Error('Invalid or failed D1 query response');
    }
    return result[0].results;
  }
  return {
    query,
    async listIds() {
      const ids = [];
      const cursors = new Set();
      let total;
      let cursor = '';
      do {
        const page = await request(`${index}/list?count=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, 'GET');
        if (!page || !Array.isArray(page.vectors) || typeof page.isTruncated !== 'boolean' || page.count !== page.vectors.length ||
          !Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || (total !== undefined && total !== page.totalCount)) {
          throw new Error('Invalid Vectorize list response');
        }
        total = page.totalCount;
        ids.push(...page.vectors.map(v => v.id));
        if (ids.length > 10_000) throw new Error('Vectorize inventory exceeds the catalog limit');
        if (!page.isTruncated) break;
        cursor = page.nextCursor;
        if (!cursor || cursors.has(cursor)) throw new Error('Invalid Vectorize pagination cursor');
        cursors.add(cursor);
      } while (cursor);
      if (ids.length !== total) throw new Error('Incomplete Vectorize inventory; retry after pending mutations settle');
      return ids;
    },
    getVectors: ids => request(`${index}/get_by_ids`, { ids }),
    async embed(records) {
      const text = records.map(r => [r.nickname, r.name, r.category, r.description, r.author].filter(Boolean).join(' '));
      const units = embeddingReservation(text);
      const id = await reserveBudget(query, units);
      // Do not retry a possibly billed request against a single reservation.
      let result;
      try { result = await request(`/ai/run/${EMBEDDING_MODEL}`, { text }, 'POST', 0); }
      catch (error) {
        if (error instanceof CompletedRequestError) await finishBudget(query, id, units);
        throw error;
      }
      await finishBudget(query, id, units);
      if (!Array.isArray(result?.data) || result.data.length !== text.length || result.data.some(vector =>
        !Array.isArray(vector) || vector.length === 0 || vector.some(value => typeof value !== 'number' || !Number.isFinite(value)))) {
        throw new Error('Invalid embedding response');
      }
      return result.data;
    },
    async upsert(vectors) {
      const body = new FormData();
      body.set('vectors', new Blob([vectors.map(v => JSON.stringify(v)).join('\n') + '\n'], { type: 'application/x-ndjson' }), 'vectors.ndjson');
      await mutation('/upsert?unparsable-behavior=error', body);
    },
    remove: ids => mutation('/delete_by_ids', { ids }),
  };
}

module.exports = { createCloudflareClient };
