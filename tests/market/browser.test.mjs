import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
test("responsive storefront browse and detail navigation", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "arirang-browse-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      path.join(tmp, "key.pem"),
      "-out",
      path.join(tmp, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" },
  );
  const region = {
      id: "11111111-1111-4111-8111-111111111112",
      name: "대전 동구 홍도동",
      province: "대전",
      city: "대전",
      district: "동구",
      dong: "홍도동",
      level: "dong",
      active: true,
    },
    store = {
      id: "22222222-2222-4222-8222-222222222222",
      name: "테스트 매장",
      deliveryFee: 2500,
      minimumOrder: 0,
    };
  const products = [
    {
      id: "33333333-3333-4333-8333-333333333333",
      title: "테스트 사과",
      category: "fruit",
      subcategory: "apple-pear",
      origin: "국내산",
      unit: "3입",
      price: 5000,
      stock: 3,
      store_id: store.id,
      storeName: store.name,
      storage: "ambient",
    },
  ];
  const server = https.createServer(
    {
      key: readFileSync(path.join(tmp, "key.pem")),
      cert: readFileSync(path.join(tmp, "cert.pem")),
    },
    (req, res) => {
      const u = new URL(req.url, "https://localhost");
      if (u.pathname.startsWith("/market-api")) {
        const data = u.pathname.endsWith("/config")
          ? { liveOrders: false }
          : u.pathname.endsWith("/session")
            ? { staff: null, customer: null }
            : u.pathname.endsWith("/regions")
              ? [region]
              : u.pathname.endsWith("/location")
                ? { region, source: "geolocation" }
                : u.pathname.endsWith("/stores")
                  ? [store]
                  : products;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify(data));
      }
      const file = path.resolve("public", "." + u.pathname);
      if (!file.startsWith(path.resolve("public") + path.sep)) {
        res.statusCode = 403;
        return res.end();
      }
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
        }[path.extname(file)] || "application/octet-stream",
      );
      try {
        res.end(readFileSync(file));
      } catch {
        res.statusCode = 404;
        res.end();
      }
    },
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.DAPANDA_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.DAPANDA_CHROMIUM_EXECUTABLE }
        : {}),
    });
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      "https://127.0.0.1:" + server.address().port + "/arirang-market.html",
    );
    await page.locator(".product-card").waitFor();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 940 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.equal(await page.locator("#marketSearch").isVisible(), true);
      assert.equal(
        await page.locator("[data-customer-view=cart]").isVisible(),
        true,
      );
    }
    await page.locator("[data-browse-major=fresh]").click();
    assert.equal(await page.locator(".specialty-halls").count(), 0);
    await page.locator("[data-browse-category=fruit]").click();
    await page.locator("[data-browse-leaf=apple-pear]").click();
    await page.locator("[data-detail]").click();
    await page.locator("#productDetail[open]").waitFor();
    await page.locator("[data-close-detail]").first().click();
    assert.equal(
      await page
        .locator("[data-browse-leaf=apple-pear]")
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("[data-customer-view=shop]").click();
    await page.locator(".specialty-halls").waitFor();
    await page.locator("#marketSearchInput").fill("사과");
    await page.locator("#marketSearch").press("Enter");
    assert.equal(await page.locator(".specialty-halls").count(), 0);
    assert.equal(await page.locator(".product-card").count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    rmSync(tmp, { recursive: true, force: true });
  }
});
