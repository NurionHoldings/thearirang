import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { marketHandler } from "../../netlify/functions/market.mjs";
import { makeMarketService } from "../../netlify/functions/_market/service.mjs";
const require = createRequire(import.meta.url),
  { chromium } = require("playwright");
test("customer, merchant, rider and operator complete regional order workflow through real HTTP APIs", async () => {
  const db = new PGlite();
  await db.exec(
    readFileSync(
      "netlify/database/migrations/20261101140000_market.sql",
      "utf8",
    ),
  );
  let tail = Promise.resolve();
  const pool = {
    query: (s, p) => db.query(s, p),
    async connect() {
      const before = tail;
      let release;
      tail = new Promise((r) => (release = r));
      await before;
      return { query: (s, p) => db.query(s, p), release };
    },
  };
  const env = (k) =>
    ({
      ARIRANG_MARKET_LIVE_ORDERS: "true",
      KAKAO_REST_API_KEY: "test-key",
      ARIRANG_MARKET_PRIVACY_URL: "https://example.test/privacy",
      ARIRANG_MARKET_OPERATOR_PASSWORD: "browser-operator-password-123",
    })[k];
  const area = {
      region_1depth_name: "대전",
      region_2depth_name: "동구",
      region_3depth_name: "홍도동",
      region_type: "H",
    },
    service = makeMarketService(pool, {
      env,
      fetcher: async (u) =>
        Response.json({
          documents: u.includes("coord2regioncode")
            ? [area]
            : [{ address: area, address_name: "대전 동구 홍도동 1" }],
        }),
    }),
    op = { id: "operator", role: "operator" };
  const city = await service.createRegion(op, {
      name: "공주시",
      province: "충남",
      city: "공주시",
      level: "city",
      cityType: "small",
      aliases: ["gongju"],
      active: true,
    }),
    dong = await service.createRegion(op, {
      name: "대전 동구 홍도동",
      province: "대전",
      city: "대전",
      district: "동구",
      dong: "홍도동",
      level: "dong",
      cityType: "large",
      active: true,
    });
  const store = await service.createStore(op, {
    name: "지역 테스트 식품점",
    regionId: dong.id,
    address: "대전 동구 매장",
    deliveryFee: 2500,
    minimumOrder: 5000,
  });
  await service.storeState(op, store.id, { status: "active", open: true });
  const merchant = await service.account(op, {
      username: "browser-merchant",
      name: "판매자",
      role: "merchant",
      storeId: store.id,
    }),
    rider = await service.account(op, {
      username: "browser-rider",
      name: "라이더",
      role: "rider",
      regionIds: [dong.id],
    });
  await service.addProduct(
    { id: merchant.id, role: "merchant", storeId: store.id },
    {
      title: "실거래 테스트용 사과",
      category: "fruit",
      unit: "3입",
      price: 5000,
      stock: 10,
      origin: "국내산",
      storage: "ambient",
      active: true,
    },
  );
  const handler = marketHandler(() => service, env),
    tmp = mkdtempSync(path.join(os.tmpdir(), "arirang-market-tls-"));
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
  const server = https.createServer(
    {
      key: readFileSync(path.join(tmp, "key.pem")),
      cert: readFileSync(path.join(tmp, "cert.pem")),
    },
    async (req, res) => {
      try {
        const origin = "https://127.0.0.1:" + server.address().port,
          url = new URL(req.url, origin);
        if (url.pathname.startsWith("/market-api")) {
          let body = "";
          for await (const chunk of req) body += chunk;
          const request = new Request(url, {
            method: req.method,
            headers: req.headers,
            ...(body ? { body } : {}),
          });
          const out = await handler(request, {
            ip: "test-browser",
            geo: { city: "gongju" },
          });
          res.writeHead(out.status, Object.fromEntries(out.headers));
          res.end(Buffer.from(await out.arrayBuffer()));
          return;
        }
        const file = path.join(
          process.cwd(),
          "public",
          url.pathname === "/app" ? "arirang-local.html" : url.pathname,
        );
        res.setHeader(
          "Content-Type",
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
          }[path.extname(file)] || "application/octet-stream",
        );
        try {
          res.end(readFileSync(file));
        } catch {
          res.statusCode = 404;
          res.end();
        }
      } catch (error) {
        res.statusCode = 500;
        res.end("test server error");
      }
    },
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "https://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.DAPANDA_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.DAPANDA_CHROMIUM_EXECUTABLE }
        : {}),
    });
  } catch (error) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await db.close();
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  const errors = [];
  const contexts = [];
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 940 },
      permissions: ["geolocation"],
      geolocation: { latitude: 36.3, longitude: 127.4 },
    });
    contexts.push(context);
    const customer = await context.newPage();
    customer.on("pageerror", (e) => errors.push(e.message));
    await customer.goto(base + "/arirang-local.html");
    await customer.waitForFunction(
      () => document.querySelector("#regionSelect")?.value,
    );
    assert.equal(await customer.locator("#regionSelect").inputValue(), city.id);
    await customer.locator("#locate").click();
    await customer.waitForFunction(
      (id) => document.querySelector("#regionSelect")?.value === id,
      dong.id,
    );
    await customer.locator("[data-store]").click();
    await customer.locator("[data-add]").click();
    await customer.locator("[data-add]").click();
    await customer
      .locator("#checkoutForm [name=customerName]")
      .fill("테스트 고객");
    await customer.locator("#checkoutForm [name=phone]").fill("01000000000");
    await customer
      .locator("#checkoutForm [name=addressBase]")
      .fill("대전 동구 홍도동 1");
    await customer.locator("#checkoutForm [name=addressDetail]").fill("101호");
    await customer.locator("#checkoutForm [name=consent]").check();
    await customer.locator("#checkAddress").click();
    await customer.waitForFunction(() =>
      document
        .querySelector("#addressResult")
        ?.textContent.includes("확인 완료"),
    );
    await customer.locator("#checkoutForm [type=submit]").click();
    await customer.locator(".order-card").waitFor();
    assert(
      (await customer.locator(".order-card").innerText()).includes("12,500원"),
    );
    const code = await customer.locator(".delivery-code strong").innerText();
    const partner = async (role, data) => {
      const c = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 940 },
      });
      contexts.push(c);
      const page = await c.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/arirang-local.html#staff");
      await page.locator("#staffLogin [name=username]").fill(data.username);
      await page.locator("#staffLogin [name=password]").fill(data.password);
      if (role === "operator")
        await page.locator("#staffLogin [name=role]").selectOption("operator");
      await page.locator("#staffLogin button").click();
      await page.locator("#staffLogout").waitFor();
      return page;
    };
    const seller = await partner("merchant", merchant);
    for (const action of ["accept", "prepare", "ready"]) {
      await seller.locator("[data-order-action=" + action + "]").click();
      await seller.waitForFunction(
        (a) => !document.querySelector("[data-order-action=" + a + "]"),
        action,
      );
    }
    const driver = await partner("rider", rider);
    await driver.locator("#riderDuty").check();
    await driver.locator("[data-order-action=claim]").waitFor();
    assert(
      (await driver.locator(".order-card").innerText()).includes(
        "배차 수락 후 공개",
      ),
    );
    await driver.locator("[data-order-action=claim]").click();
    await driver.locator("[data-order-action=pickup]").waitFor();
    assert((await driver.locator(".order-card").innerText()).includes("101호"));
    await driver.locator("[data-order-action=pickup]").click();
    await driver.locator("[data-code-for]").waitFor();
    await driver.locator("[data-code-for]").fill(code);
    await driver.locator("[data-order-action=deliver]").click();
    await driver.waitForFunction(() =>
      document
        .querySelector(".order-card h2")
        ?.textContent.includes("배송 완료"),
    );
    await customer.locator("#refreshOrders").click();
    await customer.waitForFunction(() =>
      document
        .querySelector(".order-card h2")
        ?.textContent.includes("배송 완료"),
    );
    assert(
      (await customer.locator(".payment-note").innerText()).includes(
        "결제 확인 안 됨",
      ),
    );
    const manager = await partner("operator", {
      username: "operator",
      password: env("ARIRANG_MARKET_OPERATOR_PASSWORD"),
    });
    await manager.locator("[data-view=operations]").click();
    await manager.locator("#regionForm").waitFor();
    const form = manager.locator("#regionForm");
    await form.locator("[name=name]").fill("당진시");
    await form.locator("[name=province]").fill("충남");
    await form.locator("[name=city]").fill("당진시");
    await form.locator("[name=aliases]").fill("dangjin");
    await form.locator("[name=active]").check();
    await form.locator("button").click();
    await manager.waitForFunction(() =>
      [...document.querySelectorAll(".data-list strong")].some(
        (n) => n.textContent === "당진시",
      ),
    );
    for (const width of [320, 390, 768, 1440]) {
      await customer.setViewportSize({ width, height: 940 });
      assert(
        await customer.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await manager.setViewportSize({ width, height: 940 });
      assert(
        await manager.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    await customer.screenshot({ path: "/tmp/arirang-local-delivered.png" });
    await manager.screenshot({ path: "/tmp/arirang-local-operations.png" });
    assert.deepEqual(errors, []);
    // HTTP writes fail closed without an origin, and a different device cannot read the customer's order.
    const denied = await manager.request.post(base + "/market-api/regions", {
      data: {},
    });
    assert.equal(denied.status(), 403);
    const stranger = await browser.newContext({ ignoreHTTPSErrors: true });
    contexts.push(stranger);
    assert.equal(
      (await stranger.request.get(base + "/market-api/orders")).status(),
      403,
    );
  } catch (error) {
    console.error(error.stack);
    throw error;
  } finally {
    for (const c of contexts) await c.close();
    await browser.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await db.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
