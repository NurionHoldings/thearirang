import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  makeMemberService,
  identityCustomer,
} from "../../netlify/functions/_market/member.mjs";
import { marketHandler } from "../../netlify/functions/market.mjs";
const alice = identityCustomer({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "테스트 A",
    email: "a@example.test",
  }),
  bob = identityCustomer({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "테스트 B",
    email: "b@example.test",
  }),
  input = {
    label: "집",
    recipientName: "테스트",
    phone: "01000000000",
    addressBase: "대전 동구 홍도동 1",
    addressDetail: "101호",
    deliveryNote: "문 앞",
    consent: true,
  };
async function setup(env = () => undefined) {
  const db = new PGlite();
  for (const f of readdirSync("netlify/database/migrations").sort())
    await db.exec(readFileSync("netlify/database/migrations/" + f, "utf8"));
  let tail = Promise.resolve();
  const pool = {
    query: (q, p) => db.query(q, p),
    async connect() {
      const before = tail;
      let release;
      tail = new Promise((r) => (release = r));
      await before;
      return { query: (q, p) => db.query(q, p), release };
    },
  };
  const service = makeMemberService(pool, {
    env,
    fetcher: async () =>
      Response.json({
        documents: [
          {
            address_name: input.addressBase,
            address: {
              region_1depth_name: "대전",
              region_2depth_name: "동구",
              region_3depth_name: "홍도동",
            },
            road_address: {
              address_name: "대전 동구 홍도로 11",
              zone_no: "34500",
            },
          },
        ],
      }),
  });
  return { db, service, pool };
}
test("member address privacy, defaults, persistence, optimistic edits, max count, deletion and unverified state", async () => {
  const { db, service: s } = await setup();
  try {
    await assert.rejects(() => s.sync({ id: "guest", role: "customer" }), {
      status: 401,
    });
    await s.sync(alice);
    await s.sync(bob);
    const first = await s.save(alice, input);
    assert.equal(first.verified, false);
    assert.equal(first.serviceable, false);
    let a = await s.me(alice);
    assert.equal(a.addresses.length, 1);
    assert.equal(a.selectedAddressId, first.id);
    assert.equal(a.addresses[0].is_default, true);
    assert.equal(a.addresses[0].address_detail, "101호");
    assert.equal((await s.me(bob)).addresses.length, 0);
    await assert.rejects(() => s.select(bob, first.id), { status: 404 });
    await assert.rejects(
      () => s.save(bob, { ...input, version: 1 }, first.id),
      { status: 404 },
    );
    await assert.rejects(() => s.remove(bob, first.id, 1), { status: 404 });
    await assert.rejects(() => s.orderAddress(alice, first.id), {
      status: 409,
    });
    await s.save(alice, { ...input, label: "회사", version: 1 }, first.id);
    await assert.rejects(
      () => s.save(alice, { ...input, version: 1 }, first.id),
      { status: 409 },
    );
    const second = await s.save(alice, { ...input, label: "두 번째" });
    await s.select(alice, second.id, true);
    a = await s.me(alice);
    assert.equal(a.addresses.filter((x) => x.is_default).length, 1);
    assert.equal(a.selectedAddressId, second.id);
    await s.remove(alice, second.id, 1);
    a = await s.me(alice);
    assert.equal(a.selectedAddressId, first.id);
    assert.equal(a.addresses[0].is_default, true);
    for (let i = 1; i < 10; i++)
      await s.save(alice, { ...input, label: "배송지" + i });
    await assert.rejects(() => s.save(alice, input), { status: 409 });
    assert.equal((await s.me(alice)).addresses.length, 10);
    await assert.rejects(() => s.save(alice, { ...input, consent: false }));
    assert.equal((await s.me(null)).member, null);
  } finally {
    await db.close();
  }
});
test("verified addresses use canonical provider data and server region, then recheck unverified entries when a key becomes available", async () => {
  const { db, service: s, pool } = await setup();
  try {
    await s.sync(alice);
    const saved = await s.save(alice, {
      ...input,
      regionId: "forged",
      verified: true,
    });
    const enabled = makeMemberService(pool, {
      env: (k) => (k === "KAKAO_REST_API_KEY" ? "test-only" : undefined),
      fetcher: async () =>
        Response.json({
          documents: [
            {
              address_name: input.addressBase,
              address: {
                region_1depth_name: "대전",
                region_2depth_name: "동구",
                region_3depth_name: "홍도동",
              },
              road_address: {
                address_name: "대전 동구 홍도로 11",
                zone_no: "34500",
              },
            },
          ],
        }),
    });
    await enabled.save(alice, { ...input, version: 1 }, saved.id);
    const row = await enabled.orderAddress(alice, saved.id);
    assert.equal(row.region_id, "11111111-1111-4111-8111-111111111112");
    assert.equal(row.address_base, "대전 동구 홍도로 11");
    assert.equal(row.postal_code, "34500");
    const failing = makeMemberService(pool, {
      env: () => "test-only",
      fetcher: async () =>
        Response.json({ error: "provider" }, { status: 500 }),
    });
    await assert.rejects(
      () => failing.save(alice, { ...input, addressBase: "다른 주소" }),
      { status: 502 },
    );
    assert.equal((await enabled.me(alice)).addresses.length, 1);
  } finally {
    await db.close();
  }
});
test("member HTTP endpoints require verified Identity actor, ignore guest/staff cookies and forged client identities, and reject cross-origin writes", async () => {
  const { db, service } = await setup();
  try {
    const base = "https://example.test",
      request = (p, body, origin = base) =>
        new Request(base + "/market-api" + p, {
          method: body ? "POST" : "GET",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Cookie:
              "__Host-arirang_customer=guest; __Host-arirang_market=operator",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
    let user = null;
    const h = marketHandler(
      () => ({
        members: service,
        session: async (t) =>
          t === "operator"
            ? { id: "operator", role: "operator" }
            : { id: "guest", role: "customer" },
      }),
      () => undefined,
      async () => user,
    );
    assert.equal(
      (
        await h(
          request("/member/addresses", {
            ...input,
            member: true,
            customerId: alice.id,
          }),
        )
      ).status,
      401,
    );
    assert.equal(
      (await h(request("/member/addresses", input, "https://attacker.test")))
        .status,
      403,
    );
    assert.equal((await h(request("/member/me"))).status, 200);
    user = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "A",
      email: "a@example.test",
    };
    assert.equal((await h(request("/member/session", {}))).status, 200);
    assert.equal((await h(request("/member/addresses", input))).status, 201);
    const me = await (await h(request("/member/me"))).json();
    assert.equal(me.addresses.length, 1);
    user = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      email: "b@example.test",
    };
    assert.equal(
      (await (await h(request("/member/me"))).json()).addresses.length,
      0,
    );
  } finally {
    await db.close();
  }
});
