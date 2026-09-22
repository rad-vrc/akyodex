import assert from "node:assert/strict";
import test from "node:test";
import * as Sentry from "@sentry/react";
import { handleCatalogRequest } from "../api/catalog/catalog-handler";
import { withCatalogWorkerTiming } from "@/lib/catalog-diagnostics";
import { withWorkerResponseHeaders } from "@/lib/worker-version-headers";
import { serializeCatalogPayload } from "@/lib/catalog-payload";
import { resolveBrowserSentryOptions } from "@/lib/sentry-client-init";
import { loadCompleteCatalogData } from "./catalog-data-loader";
import { CatalogLoadPerformance, createCatalogSlowLoadReporter } from "./catalog-performance";
import type { AkyoData } from "@/types/akyo";

test("actual handler -> Worker headers -> loader -> Sentry transport retains slow KV evidence", async () => {
  const row: AkyoData = {
    id: "0001", entryType: "avatar", avatarName: "test", nickname: "test",
    appearance: "", category: "", comment: "", author: "", attribute: "", notes: "", creator: "", avatarUrl: "",
  };
  const payload = await serializeCatalogPayload("ja", [row]);
  let time = 0;
  const measurement = new CatalogLoadPerformance("ja", {
    timeOrigin: Date.now(), now: () => time, mark() {}, measure() {},
  });
  const result = await loadCompleteCatalogData({
    lang: "ja", catalogUrl: "/api/catalog/ja", r2BaseUrl: "https://unused.example",
    now: () => time, phaseRecorder: measurement,
    fetchImpl: async (url, init) => {
      const request = new Request(`https://example.com${url}`, init);
      const response = withWorkerResponseHeaders(await withCatalogWorkerTiming(request, async () => {
        time += 100;
        return handleCatalogRequest(request, "ja", {
          now: () => time,
          readCached: async () => { time += 8100; return payload.text; },
          loadData: async () => { throw new Error("KV hit must not load fallback"); },
        });
      }, () => time), { id: "test-version" }, "production");
      time += 50;
      const json = response.json.bind(response);
      response.json = async () => { time += 150; return json(); };
      return response;
    },
  });
  measurement.markResponse(result.source);
  measurement.startPhase("search-index");
  time += 9;
  measurement.endPhase("search-index");
  const event = measurement.markReady()!;
  assert.equal(result.items.length, 1);
  assert.equal(event.requests[0].headersWaitMs, 8250);
  assert.equal(event.requests[0].bodyAndParseMs, 150);
  assert.equal(event.phaseDurationsMs.searchIndex, 9);

  for (const environment of ["production", "lighthouse-ci"]) {
    const delivered: Sentry.Event[] = [];
    const options = resolveBrowserSentryOptions({ dsn: "https://public@o1.ingest.sentry.io/1", environment, nodeEnv: "production" });
    const client = new Sentry.BrowserClient({
      ...options, stackParser: Sentry.defaultStackParser, integrations: [Sentry.dedupeIntegration()],
      transport: (transportOptions) => Sentry.createTransport(transportOptions, async () => ({ statusCode: 200 })),
    });
    client.on("beforeEnvelope", (envelope) => {
      for (const item of envelope[1]) if (item[0].type === "event") delivered.push(item[1] as Sentry.Event);
    });
    Sentry.setCurrentClient(client);
    client.init();
    try {
      const report = createCatalogSlowLoadReporter((message, context) => { Sentry.captureMessage(message, context); });
      report(event);
      report(event);
      await client.flush(2000);
      assert.equal(delivered.length, environment === "production" ? 1 : 0);
      if (delivered[0]) {
        const requests = delivered[0].extra?.requests as Record<string, unknown>[];
        assert.equal(requests[0].catalog_kv, 8100, "SDK normalization must preserve nested timing values");
        assert.equal(requests[0].catalog_worker, 8200);
        assert.equal(requests[0].serverSource, "kv-payload");
        assert.match(String(requests[0].responseId), /^[a-f0-9-]{36}$/);
        assert.doesNotMatch(JSON.stringify(delivered[0].extra), /example\.com|avatarUrl|nickname/);
      }
    } finally { await client.close(); }
  }
});
