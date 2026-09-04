import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { createCatalogPayload } from "../src/lib/catalog-payload";
import type { AkyoData } from "../src/types/akyo";

/** 半透明の単色 PNG を作る。二重合成されると色が濃くなるので、最終描画の重なりを判定できる。 */
function createTranslucentImage(width: number, height: number, alpha: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 4;
      raw[p] = 0;
      raw[p + 1] = 0;
      raw[p + 2] = 0;
      raw[p + 3] = alpha;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * 要素の中央 16x16 の平均色を、ページ自身に自分のスクリーンショットを復号させて読む。
 * 要素基準で撮るので、ダイアログの出現アニメーションによる座標のずれに影響されない。
 * 方眼の細線を拾わないよう平均を取る。
 */
async function centerColor(page: Page, target: Locator): Promise<number[]> {
  await settle(page);
  const shot = await target.screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const size = 16;
    const data = context.getImageData(
      Math.floor(image.width / 2) - size / 2,
      Math.floor(image.height / 2) - size / 2,
      size,
      size,
    ).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const pixels = data.length / 4;
    return [Math.round(r / pixels), Math.round(g / pixels), Math.round(b / pixels)];
  }, shot.toString("base64"));
}

/** CSS トランジション（モーダルの出現・ズームの 300ms）が終わるまで待つ。 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

const imageBody = readFileSync(
  path.join(process.cwd(), "public", "images", "profileIcon.webp"),
);
const catalog = JSON.parse(readFileSync(path.join(process.cwd(), "data/akyo-data-ja.json"), "utf8")) as { data: AkyoData[] };
const pageErrors = new WeakMap<Page, string[]>();

async function replaceFirstCatalogEntry(page: Page, overrides: Partial<AkyoData>): Promise<void> {
  const entries = catalog.data.map((entry) => entry.id === "0001" ? { ...entry, ...overrides } : entry);
  const payload = await createCatalogPayload("ja", entries);
  await page.route("**/api/catalog/ja", (route) => route.fulfill({ json: payload }));
}

async function openFirstAvatarDetail(page: Page): Promise<Locator> {
  const firstCard = page.locator("article.akyo-card").first();
  await expect(firstCard).toBeVisible();
  await firstCard.locator(".detail-button").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectImageLoaded(image: Locator): Promise<void> {
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const htmlImage = element as HTMLImageElement;
        return htmlImage.complete && htmlImage.naturalWidth > 0;
      }),
    )
    .toBe(true);
}

function fulfillWebP(route: Route): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "image/webp",
    body: imageBody,
  });
}

async function holdModalChunk(page: Page) {
  let release!: () => void;
  let markRequested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { markRequested = resolve; });
  let held = false;
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (!held && body.includes(Buffer.from("data-reference-primary-image"))) {
      held = true;
      markRequested();
      await gate;
    }
    await route.fulfill({ response, body });
  });
  return { requested, release };
}

test.describe("Pre-generated reference sheet modal", () => {
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ context, page }) => {
    const errors: string[] = [];
    pageErrors.set(page, errors);
    page.on("pageerror", (error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await context.addCookies([
      {
        name: "AKYO_LANG",
        value: "ja",
        url: "http://localhost:3000",
      },
    ]);
  });

  test.afterEach(async ({ page }) => {
    expect(pageErrors.get(page)).toEqual([]);
  });

  test("requests only the 960px derivative after the modal opens", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/0001-960.webp", fulfillWebP);
    await page.route("**/reference/0001-1920.webp", fulfillWebP);
    await page.route("**/0001.png", fulfillWebP);

    await page.goto("/zukan");
    expect(requested.filter((url) => url.includes("/reference/0001-"))).toHaveLength(0);

    const dialog = await openFirstAvatarDetail(page);
    const preview = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expect(preview).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);
    await expectImageLoaded(preview);

    expect(requested.filter((url) => url.endsWith("/reference/0001-960.webp"))).toHaveLength(1);
    expect(requested.filter((url) => url.endsWith("/reference/0001-1920.webp"))).toHaveLength(0);
    expect(requested.filter((url) => url.endsWith("/0001.png"))).toHaveLength(0);
    expect(requested.filter((url) => url.includes("/api/reference-image"))).toHaveLength(0);
    await expect(dialog.getByRole("status")).toHaveCount(0);
  });

  test("Escape cancels a pending modal import without requesting an image", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/*.webp", fulfillWebP);
    await page.goto("/zukan");
    const chunk = await holdModalChunk(page);
    try {
      await page.locator("article.akyo-card .detail-button").first().click();
      await chunk.requested;
      await page.keyboard.press("Escape");
    } finally {
      chunk.release();
    }
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(requested.filter((url) => url.includes("/reference/"))).toHaveLength(0);

    const dialog = await openFirstAvatarDetail(page);
    await expectImageLoaded(dialog.getByAltText("オリジンAkyo", { exact: true }));
    expect(requested.filter((url) => url.includes("/reference/"))).toEqual([
      expect.stringMatching(/\/0001-960\.webp$/),
    ]);
  });

  test("a pending modal import opens only the latest selected Akyo", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/*.webp", fulfillWebP);
    await page.goto("/zukan");
    const chunk = await holdModalChunk(page);
    try {
      await page.locator('article[aria-labelledby="card-title-0001"] .detail-button').click();
      await chunk.requested;
      await page.locator('article[aria-labelledby="card-title-0002"] .detail-button').click();
    } finally {
      chunk.release();
    }
    const dialog = page.getByRole("dialog");
    await expectImageLoaded(dialog.getByAltText("チョコミントAkyo", { exact: true }));
    expect(requested.filter((url) => url.includes("/reference/"))).toEqual([
      expect.stringMatching(/\/0002-960\.webp$/),
    ]);
  });

  test("leaving the catalog cancels a pending modal import", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/*.webp", fulfillWebP);
    await page.goto("/zukan");
    const chunk = await holdModalChunk(page);
    try {
      await page.locator("article.akyo-card .detail-button").first().click();
      await chunk.requested;
      await page.locator("a.admin-button").click();
      await expect(page).toHaveURL(/\/admin$/);
    } finally {
      chunk.release();
    }
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(requested.filter((url) => url.includes("/reference/"))).toHaveLength(0);
  });

  test("keeps the 960px image visible until the zoom derivative finishes", async ({ page }) => {
    await page.route("**/reference/0001-960.webp", fulfillWebP);
    let releaseZoom: (() => void) | undefined;
    const zoomRequested = new Promise<void>((resolve) => {
      void page.route("**/reference/0001-1920.webp", async (route) => {
        resolve();
        await new Promise<void>((release) => {
          releaseZoom = release;
        });
        await fulfillWebP(route);
      });
    });

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const image = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expectImageLoaded(image);
    await expect(image).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);

    await dialog
      .getByRole("button", { name: /画像のズーム切り替え|Toggle image zoom/i })
      .click({ position: { x: 120, y: 80 } });
    await zoomRequested;
    await expect(image).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);
    const zoomImage = dialog.locator("[data-reference-zoom-image]");
    await expect(zoomImage).toHaveAttribute("src", /\/reference\/0001-1920\.webp$/);
    await expect(zoomImage).toHaveClass(/opacity-0/);

    releaseZoom?.();
    await expectImageLoaded(zoomImage);
    await expect(zoomImage).toHaveClass(/opacity-100/);
    await expect(image).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);
    await expect(dialog.getByRole("status")).toHaveCount(0);
  });

  test("falls back through the generated zoom image to the original PNG", async ({ page }) => {
    await page.route("**/reference/0001-960.webp", (route) =>
      route.fulfill({ status: 404, body: "missing preview" }),
    );
    await page.route("**/reference/0001-1920.webp", (route) =>
      route.fulfill({ status: 404, body: "missing zoom" }),
    );
    await page.route("**/0001.png", fulfillWebP);

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const original = dialog.getByAltText("オリジンAkyo", { exact: true });

    await expect(original).toHaveAttribute("src", /\/0001\.png$/);
    await expectImageLoaded(original);
    await expect(original).not.toHaveAttribute("role", "presentation");
  });

  test("keeps a successful card fallback accessible after all reference images fail", async ({
    page,
  }) => {
    await page.route("**/reference/0001-960.webp", (route) =>
      route.fulfill({ status: 404, body: "missing preview" }),
    );
    await page.route("**/reference/0001-1920.webp", (route) =>
      route.fulfill({ status: 404, body: "missing zoom" }),
    );
    await page.route("**/0001.png", (route) =>
      route.fulfill({ status: 404, body: "missing original" }),
    );
    await page.route("**/api/avatar-image?id=0001**", fulfillWebP);

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const fallbackImage = dialog.locator('img[src*="/api/avatar-image?id=0001"]');

    await expectImageLoaded(fallbackImage);
    await expect(fallbackImage).toHaveAttribute("alt", "オリジンAkyo");
    await expect(fallbackImage).not.toHaveAttribute("role", "presentation");
    await expect(fallbackImage).not.toHaveAttribute("style", /linear-gradient/);
  });

  test("retries from the 960px derivative when reopening the same Akyo", async ({ page }) => {
    let previewRequests = 0;
    await page.route("**/reference/0001-960.webp", async (route) => {
      previewRequests += 1;
      if (previewRequests === 1) {
        await route.fulfill({ status: 502, body: "temporary failure" });
        return;
      }
      await fulfillWebP(route);
    });
    await page.route("**/reference/0001-1920.webp", (route) =>
      route.fulfill({ status: 404, body: "missing zoom" }),
    );
    await page.route("**/0001.png", fulfillWebP);

    await page.goto("/zukan");
    let dialog = await openFirstAvatarDetail(page);
    await expect(dialog.getByAltText("オリジンAkyo", { exact: true })).toHaveAttribute(
      "src",
      /\/0001\.png$/,
    );

    await dialog.getByRole("button", { name: /閉じる|Close|닫기/i }).click();
    await expect(dialog).toBeHidden();

    dialog = await openFirstAvatarDetail(page);
    const recovered = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expect(recovered).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);
    await expectImageLoaded(recovered);
    expect(previewRequests).toBe(2);
  });

  test("does not request 1920px on reopening after zoom, across three sessions", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/*.webp", fulfillWebP);
    await page.goto("/zukan");
    for (let run = 0; run < 3; run += 1) {
      let dialog = await openFirstAvatarDetail(page);
      await expectImageLoaded(dialog.getByAltText("オリジンAkyo", { exact: true }));
      await dialog.locator('[role="button"][aria-roledescription]').click({ position: { x: 120, y: 80 } });
      await expect(dialog.locator("[data-reference-zoom-image]")).toHaveClass(/opacity-100/);
      await dialog.getByRole("button", { name: /閉じる|Close|닫기/i }).click();
      await expect(dialog).toBeHidden();
      const before = requested.length;

      dialog = await openFirstAvatarDetail(page);
      await expectImageLoaded(dialog.getByAltText("オリジンAkyo", { exact: true }));
      await expect(dialog.locator("[data-reference-zoom-image]")).toHaveCount(0);
      const opened = requested.slice(before).filter((url) => url.includes("/reference/"));
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatch(/\/0001-960\.webp$/);

      await dialog.locator('[role="button"][aria-roledescription]').click({ position: { x: 120, y: 80 } });
      await expect(dialog.locator("[data-reference-zoom-image]")).toHaveClass(/opacity-100/);
      expect(requested.slice(before).filter((url) => url.endsWith("/0001-1920.webp"))).toHaveLength(1);
      await dialog.getByRole("button", { name: /閉じる|Close|닫기/i }).click();
      await expect(dialog).toBeHidden();
    }
  });

  test("opens a different Akyo with no previous image or zoom request", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/*.webp", fulfillWebP);
    await page.goto("/zukan");
    let dialog = await openFirstAvatarDetail(page);
    await expectImageLoaded(dialog.getByAltText("オリジンAkyo", { exact: true }));
    await dialog.locator('[role="button"][aria-roledescription]').click({ position: { x: 120, y: 80 } });
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveClass(/opacity-100/);
    await dialog.getByRole("button", { name: /閉じる|Close|닫기/i }).click();
    await expect(dialog).toBeHidden();
    const before = requested.length;
    await page.locator('article[aria-labelledby="card-title-0002"] .detail-button').click();
    dialog = page.getByRole("dialog");
    await expectImageLoaded(dialog.getByAltText("チョコミントAkyo", { exact: true }));
    expect(requested.slice(before).filter((url) => url.includes("/reference/"))).toEqual([
      expect.stringMatching(/\/0002-960\.webp$/),
    ]);
  });

  test("retains 960px after zoom failure and does not retry until another session", async ({ page }) => {
    let zoomRequests = 0;
    await page.route("**/reference/0001-960.webp", fulfillWebP);
    await page.route("**/reference/0001-1920.webp", (route) => {
      zoomRequests += 1;
      return route.fulfill({ status: 404, body: "missing zoom" });
    });
    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const image = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expectImageLoaded(image);
    const viewer = dialog.locator('[role="button"][aria-roledescription]');
    await viewer.press("Enter");
    await expect.poll(() => zoomRequests).toBe(1);
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveCount(0);
    await viewer.press("Enter");
    await viewer.press("Enter");
    await expect(image).toHaveAttribute("src", /\/0001-960\.webp$/);
    await expectImageLoaded(image);
    expect(zoomRequests).toBe(1);
  });

  test("reuses the in-flight zoom image as primary fallback when preview fails during zoom", async ({ page }) => {
    let failPreview!: () => void;
    const previewGate = new Promise<void>((resolve) => { failPreview = resolve; });
    let finishZoom!: () => void;
    const zoomGate = new Promise<void>((resolve) => { finishZoom = resolve; });
    let zoomStarted!: () => void;
    const zoomRequest = new Promise<void>((resolve) => { zoomStarted = resolve; });
    let zoomRequests = 0;
    await page.route("**/reference/0001-960.webp", async (route) => {
      await previewGate;
      await route.fulfill({ status: 404, body: "preview unavailable" });
    });
    await page.route("**/reference/0001-1920.webp", async (route) => {
      zoomRequests += 1;
      zoomStarted();
      await zoomGate;
      await fulfillWebP(route);
    });
    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    await dialog.locator('[role="button"][aria-roledescription]').click({ position: { x: 120, y: 80 } });
    await zoomRequest;
    failPreview();
    const primaryImage = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expect(primaryImage).toHaveAttribute("src", /\/0001-1920\.webp$/);
    finishZoom();
    await expectImageLoaded(primaryImage);
    await expect(primaryImage).toBeVisible();
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveCount(0);
    expect(zoomRequests).toBe(1);
  });

  test("favorite updates do not reset the image session or zoom", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/*.webp", fulfillWebP);
    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    await expectImageLoaded(dialog.getByAltText("オリジンAkyo", { exact: true }));
    const viewer = dialog.locator('[role="button"][aria-roledescription]');
    await viewer.press("Enter");
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveClass(/opacity-100/);
    const before = requested.filter((url) => url.includes("/reference/")).length;
    await dialog.getByRole("button", { name: /お気に入りに追加/ }).click();
    await expect(dialog.getByRole("button", { name: /お気に入り.*解除/ })).toBeVisible();
    await expect(viewer).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveClass(/opacity-100/);
    expect(requested.filter((url) => url.includes("/reference/"))).toHaveLength(before);
  });

  for (const originalStatus of [200, 404]) {
    test(`non-four-digit serial uses original ${originalStatus} without derivative requests`, async ({ page }) => {
      const requested: string[] = [];
      page.on("request", (request) => requested.push(request.url()));
      await replaceFirstCatalogEntry(page, {
        entryType: "booth", displaySerial: "Booth0001", nickname: "Reference test product",
        sourceUrl: "", avatarUrl: "", boothUrl: "https://example.booth.pm/items/1", category: "Booth",
      });
      await page.route("**/reference/*.webp", (route) => route.fulfill({ status: 404, body: "no derivatives" }));
      await page.route("**/Booth0001.png", (route) => originalStatus === 200
        ? fulfillWebP(route) : route.fulfill({ status: 404, body: "no original" }));
      await page.route("**/api/avatar-image?id=0001**", fulfillWebP);
      await page.goto("/zukan");
      await expect(page.locator("article.akyo-card").first()).toContainText("Reference test product");
      const before = requested.length;
      const dialog = await openFirstAvatarDetail(page);
      const image = dialog.getByAltText("Reference test product", { exact: true });
      await expectImageLoaded(image);
      await expect(image).toHaveAttribute("src", originalStatus === 200 ? /\/Booth0001\.png$/ : /\/api\/avatar-image\?id=0001/);
      expect(requested.slice(before).filter((url) => url.includes("/reference/"))).toHaveLength(0);
      expect(requested.slice(before).filter((url) => url.endsWith("/Booth0001.png"))).toHaveLength(1);
    });
  }

  test("world images keep their existing URL and dimensions without reference requests", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await replaceFirstCatalogEntry(page, {
      entryType: "world", displaySerial: "0109", nickname: "Reference test world",
      sourceUrl: "https://vrchat.com/home/world/wrld_reference-test",
      avatarUrl: "", category: "ワールド",
    });
    await page.route("**/api/vrc-world-image?wrld=wrld_reference-test**", fulfillWebP);
    await page.goto("/zukan");
    await page.getByRole("textbox", { name: "Akyo検索", exact: true }).fill("Reference test world");
    await expect(page.locator('article[aria-labelledby="card-title-0001"]')).toContainText("Reference test world");
    const before = requested.length;
    await page.locator('article[aria-labelledby="card-title-0001"] .detail-button').click();
    const dialog = page.getByRole("dialog");
    const image = dialog.getByAltText("Reference test world", { exact: true });
    await expectImageLoaded(image);
    await expect(image).toHaveAttribute("src", /\/api\/vrc-world-image\?wrld=wrld_reference-test&w=800$/);
    await expect(image).toHaveAttribute("width", "800");
    await expect(image).toHaveAttribute("height", "533");
    await dialog.locator('[role="button"][aria-roledescription]').click({ position: { x: 120, y: 80 } });
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveCount(0);
    expect(requested.slice(before).filter((url) => url.includes("/reference/"))).toHaveLength(0);
  });

  test("ズーム表示中は 960px を重ねず、半透明画像でも一枚分の描画になる", async ({ page }) => {
    // 50% の半透明を白地に重ねると約 rgb(127)、二重に重なると約 rgb(63) になる
    const translucent = createTranslucentImage(96, 54, 128);
    const serve = (route: Route) =>
      route.fulfill({ status: 200, contentType: "image/webp", body: translucent });
    await page.route("**/reference/0001-960.webp", serve);
    await page.route("**/reference/0001-1920.webp", serve);

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const primary = dialog.locator("[data-reference-primary-image]");
    await expectImageLoaded(primary);
    const viewer = dialog.locator('[role="button"][aria-roledescription]');
    const beforeZoom = await centerColor(page, viewer);
    expect(beforeZoom[0], `ズーム前は一枚分のはず: ${beforeZoom.join(",")}`).toBeGreaterThan(100);

    await viewer.click({ position: { x: 120, y: 80 } });
    const zoomImage = dialog.locator("[data-reference-zoom-image]");
    await expect(zoomImage).toHaveClass(/opacity-100/);
    await expectImageLoaded(zoomImage);

    // 最終描画が一枚分であること（二重合成なら半透明部分が濃くなる）を先に確かめる
    const zoomed = await centerColor(page, viewer);
    expect(
      Math.abs(zoomed[0] - beforeZoom[0]),
      `ズーム後も一枚分のはず（前 ${beforeZoom.join(",")} / 後 ${zoomed.join(",")}）`,
    ).toBeLessThanOrEqual(8);

    // 下地の 960px は視覚的に隠れるが、代替テキストのため DOM には残る
    await expect(primary).toHaveClass(/opacity-0/);
    await expect(primary).toHaveAttribute("alt", "オリジンAkyo");
    await expect(primary).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);

    // ズーム解除で 960px が戻る
    await viewer.dblclick({ position: { x: 120, y: 80 } });
    await expect(zoomImage).toHaveClass(/opacity-0/);
    await expect(primary).not.toHaveClass(/opacity-0/);
    const afterZoomOut = await centerColor(page, viewer);
    expect(Math.abs(afterZoomOut[0] - beforeZoom[0])).toBeLessThanOrEqual(8);
  });

  test("ズーム画像が失敗したら 960px を隠さない", async ({ page }) => {
    const translucent = createTranslucentImage(96, 54, 128);
    await page.route("**/reference/0001-960.webp", (route) =>
      route.fulfill({ status: 200, contentType: "image/webp", body: translucent }),
    );
    await page.route("**/reference/0001-1920.webp", (route) =>
      route.fulfill({ status: 404, body: "missing zoom" }),
    );

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const primary = dialog.locator("[data-reference-primary-image]");
    await expectImageLoaded(primary);
    const viewer = dialog.locator('[role="button"][aria-roledescription]');
    await viewer.press("Enter");

    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveCount(0);
    await expect(primary).not.toHaveClass(/opacity-0/);
    await expect(primary).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);
    await expectImageLoaded(primary);
  });
});
