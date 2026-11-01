import test from "node:test";
import assert from "node:assert/strict";
import { marketHandler } from "../../netlify/functions/market.mjs";
import { MarketError } from "../../netlify/functions/_market/domain.mjs";
const origin = "https://market.example.test",
  make = (path, body, headers = {}, method = "POST") =>
    new Request(origin + "/market-api" + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    });
test("request boundary enforces origin, JSON and body limit before mutations", async () => {
  let count = 0;
  const h = marketHandler(() => {
    count++;
    return { session: async () => null };
  });
  assert.equal(
    (await h(make("/regions", {}, { Origin: "https://attacker.example" })))
      .status,
    403,
  );
  assert.equal(count, 0);
  assert.equal(
    (await h(make("/regions", "x", { "Content-Type": "text/plain" }))).status,
    415,
  );
  assert.equal((await h(make("/regions", "{"))).status, 400);
  assert.equal((await h(make("/regions", "x".repeat(16385)))).status, 413);
});
test("server cookies choose actors, not client role fields, and session tokens stay HttpOnly", async () => {
  let actorSeen;
  const service = {
    session: async (t) =>
      t === "staff-token"
        ? { id: "staff", role: "rider" }
        : t === "customer-token"
          ? { id: "own-customer", role: "customer" }
          : null,
    createOrder: async (actor) => {
      if (!actor) throw new MarketError("접속 권한", 403);
      actorSeen = actor;
      return { id: "test-order" };
    },
    orders: async (a) => {
      if (!a) throw new MarketError("접속 권한", 403);
      return [];
    },
    login: async () => ({
      actor: { id: "staff", role: "rider" },
      token: "secret-session-token",
    }),
    logout: async () => {},
  };
  const h = marketHandler(() => service);
  const response = await h(
    make(
      "/orders",
      { role: "operator", customerId: "another" },
      {
        Cookie:
          "__Host-arirang_market=staff-token; __Host-arirang_customer=customer-token",
      },
    ),
  );
  assert.equal(response.status, 201);
  assert.equal(actorSeen.id, "own-customer");
  assert.equal(actorSeen.role, "customer");
  assert.equal((await h(make("/orders", undefined, {}, "GET"))).status, 403);
  const login = await h(make("/login", {}));
  const cookie = login.headers.get("set-cookie");
  for (const part of [
    "__Host-arirang_market=",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
  ])
    assert(cookie.includes(part));
  assert(!JSON.stringify(await login.json()).includes("secret-session-token"));
  assert.equal(login.headers.get("access-control-allow-origin"), null);
  const logout = await h(make("/logout", {}));
  assert(logout.headers.get("set-cookie").includes("Max-Age=0"));
});
test("database/provider failures never disclose raw connection information", async () => {
  const h = marketHandler(() => {
    throw Error("postgres://not-a-real-secret@example.test/db");
  });
  const response = await h(make("/config", undefined, {}, "GET"));
  assert.equal(response.status, 503);
  assert(!JSON.stringify(await response.json()).includes("postgres://"));
});
