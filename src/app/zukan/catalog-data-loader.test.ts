import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { AkyoData } from "@/types/akyo";
import {
  CatalogRequestCoordinator,
  loadCompleteCatalogData,
} from "./catalog-data-loader";

function createAkyo(id: string): AkyoData {
  return {
    id,
    entryType: "avatar",
    appearance: "",
    nickname: `nick-${id}`,
    avatarName: `avatar-${id}`,
    category: "動物",
    comment: "",
    author: "author",
    attribute: "動物",
    notes: "",
    creator: "author",
    avatarUrl: `https://vrchat.com/home/avatar/avtr_${id}`,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("loadCompleteCatalogData uses the API result without requesting R2", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requestedUrls.push(String(input));
    return jsonResponse({ data: [createAkyo("0001")] });
  };

  const result = await loadCompleteCatalogData({
    lang: "ja",
    r2BaseUrl: "https://images.example.com",
    fetchImpl,
  });

  assert.equal(result.source, "api");
  assert.equal(result.items[0]?.id, "0001");
  assert.deepEqual(requestedUrls, ["/api/akyo-data?lang=ja"]);
});

test("loadCompleteCatalogData falls back to R2 after an API HTTP error", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.startsWith("/api/")) return jsonResponse({ error: "down" }, 503);
    return jsonResponse({ data: [createAkyo("0002")] });
  };

  const result = await loadCompleteCatalogData({
    lang: "en",
    r2BaseUrl: "https://images.example.com/",
    fetchImpl,
  });

  assert.equal(result.source, "r2");
  assert.equal(result.items[0]?.id, "0002");
  assert.deepEqual(requestedUrls, [
    "/api/akyo-data?lang=en",
    "https://images.example.com/data/akyo-data-en.json",
  ]);
});

test("loadCompleteCatalogData keeps valid API entries and reports dropped rows", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requestedUrls.push(String(input));
    return jsonResponse({
      data: [createAkyo("0003"), { id: "", avatarName: "invalid" }],
    });
  };

  const result = await loadCompleteCatalogData({
    lang: "ko",
    r2BaseUrl: "https://images.example.com",
    fetchImpl,
  });

  assert.equal(result.source, "api");
  assert.deepEqual(result.items.map((item) => item.id), ["0003"]);
  assert.equal(result.droppedCount, 1);
  assert.deepEqual(requestedUrls, ["/api/akyo-data?lang=ko"]);
});

test("loadCompleteCatalogData falls back when every API entry is invalid", async () => {
  const payloads = [
    { data: [{ id: "", avatarName: "invalid" }] },
    { data: [createAkyo("0003")] },
  ];
  let call = 0;
  const fetchImpl: typeof fetch = async () => {
    const response = payloads[call] ?? { data: [createAkyo("0003")] };
    call += 1;
    return jsonResponse(response);
  };

  const result = await loadCompleteCatalogData({
    lang: "ko",
    r2BaseUrl: "https://images.example.com",
    fetchImpl,
  });

  assert.equal(call, 2);
  assert.equal(result.source, "r2");
  assert.equal(result.items[0]?.id, "0003");
  assert.equal(result.droppedCount, 0);
});

test("loadCompleteCatalogData reports failure when both API and R2 fail", async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({ data: [] });

  await assert.rejects(
    loadCompleteCatalogData({
      lang: "ja",
      r2BaseUrl: "https://images.example.com",
      fetchImpl,
    }),
    /API and R2 catalog requests failed/,
  );
});

test("each catalog source request has an independent timeout", async () => {
  let call = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    call += 1;
    if (call === 2) return jsonResponse({ data: [createAkyo("0004")] });
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const result = await loadCompleteCatalogData({
    lang: "ja",
    r2BaseUrl: "https://images.example.com",
    fetchImpl,
    timeoutMs: 5,
  });

  assert.equal(call, 2);
  assert.equal(result.source, "r2");
});

test("an external abort stops loading without starting the fallback", async () => {
  const controller = new AbortController();
  let call = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    call += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const loading = loadCompleteCatalogData({
    lang: "ja",
    r2BaseUrl: "https://images.example.com",
    fetchImpl,
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(loading, (error: unknown) => {
    return error instanceof Error && error.name === "AbortError";
  });
  assert.equal(call, 1);
});

test("CatalogRequestCoordinator aborts stale language requests and unmount work", () => {
  const coordinator = new CatalogRequestCoordinator();
  const japanese = coordinator.begin();
  const english = coordinator.begin();

  assert.equal(japanese.signal.aborted, true);
  assert.equal(coordinator.isCurrent(japanese.generation), false);
  assert.equal(coordinator.isCurrent(english.generation), true);

  coordinator.cancel();
  assert.equal(english.signal.aborted, true);
  assert.equal(coordinator.isCurrent(english.generation), false);
});

test("all checked-in language catalogs pass client validation without dropped rows", async () => {
  for (const lang of ["ja", "en", "ko"] as const) {
    const payload = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "data", `akyo-data-${lang}.json`),
        "utf8",
      ),
    ) as { data: unknown[] };
    const fetchImpl: typeof fetch = async () => jsonResponse(payload);

    const result = await loadCompleteCatalogData({
      lang,
      r2BaseUrl: "https://images.example.com",
      fetchImpl,
    });

    assert.equal(
      result.items.length,
      payload.data.length,
      `${lang} catalog entry count`,
    );
    assert.equal(result.droppedCount, 0, `${lang} dropped entry count`);
  }
});
