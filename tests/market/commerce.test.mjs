import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { makeMarketService } from "../../netlify/functions/_market/service.mjs";
import {
  uuid,
  regionInput,
  bestRegion,
  ipRegion,
} from "../../netlify/functions/_market/domain.mjs";
test("regional commerce transactions, tenant boundaries and delivery lifecycle", async (t) => {
  const db = new PGlite();
  await db.exec(
    readFileSync(
      "netlify/database/migrations/20261101140000_market.sql",
      "utf8",
    ),
  );
  await db.exec(readFileSync("netlify/database/migrations/20261101170000_market_product_taxonomy.sql","utf8"));
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
  const area = {
    region_1depth_name: "대전",
    region_2depth_name: "동구",
    region_3depth_name: "홍도동",
    region_type: "H",
    address_name: "대전 동구 홍도동 1",
  };
  let fetches = 0;
  const env = (k) =>
    ({
      ARIRANG_MARKET_LIVE_ORDERS: "true",
      KAKAO_REST_API_KEY: "test-not-a-real-key",
      ARIRANG_MARKET_PRIVACY_URL: "https://example.test/privacy",
      ARIRANG_MARKET_OPERATOR_PASSWORD: "test-operator-password-123",
    })[k];
  const service = makeMarketService(pool, {
      env,
      fetcher: async (url) => {
        fetches++;
        return Response.json({
          documents: url.includes("coord2regioncode")
            ? [area]
            : [{ address: area, address_name: "대전 동구 홍도동 1" }],
        });
      },
    }),
    op = { id: "operator", role: "operator" };
  const small = await service.createRegion(op, {
    name: "공주시",
    province: "충남",
    city: "공주시",
    cityType: "small",
    level: "city",
    aliases: ["gongju"],
    active: true,
  });
  const district = await service.createRegion(op, {
    name: "대전 동구",
    province: "대전",
    city: "대전",
    district: "동구",
    cityType: "large",
    level: "district",
    aliases: ["daejeon"],
    active: true,
  });
  const dong = await service.createRegion(op, {
    name: "대전 동구 홍도동",
    province: "대전",
    city: "대전",
    district: "동구",
    dong: "홍도동",
    cityType: "large",
    level: "dong",
    aliases: ["daejeon"],
    active: true,
  });
  const a = await service.createStore(op, {
    name: "테스트 매장 A",
    regionId: dong.id,
    serviceRegions: [district.id],
    address: "대전 동구",
    deliveryFee: 2500,
    minimumOrder: 5000,
  });
  const b = await service.createStore(op, {
    name: "테스트 매장 B",
    regionId: small.id,
    address: "공주시",
    deliveryFee: 1000,
    minimumOrder: 0,
  });
  for (const s of [a, b])
    await service.storeState(op, s.id, { status: "active", open: true });
  const ma = await service.account(op, {
      role: "merchant",
      name: "A 담당",
      username: "merchant-a",
      storeId: a.id,
    }),
    mb = await service.account(op, {
      role: "merchant",
      name: "B 담당",
      username: "merchant-b",
      storeId: b.id,
    });
  const ra = await service.account(op, {
      role: "rider",
      name: "동구 라이더",
      username: "rider-a",
      regionIds: [district.id],
    }),
    rb = await service.account(op, {
      role: "rider",
      name: "공주 라이더",
      username: "rider-b",
      regionIds: [small.id],
    });
  const login = async (data, role) => {
    const result = await service.login(
      { username: data.username, password: data.password, role },
      data.username,
    );
    return await service.session(result.token);
  };
  const merchantA = await login(ma, "merchant"),
    merchantB = await login(mb, "merchant"),
    riderA = await login(ra, "rider"),
    riderB = await login(rb, "rider");
  await service.duty(riderA, true);
  await service.duty(riderB, true);
  const customer = (await service.guest("test-customer")).actor,
    other = (await service.guest("other-customer")).actor;
  const product = await service.addProduct(merchantA, {
    title: "테스트 사과",
    category: "fruit",
    unit: "3입",
    price: 5000,
    stock: 10,
    active: true,
    origin: "국내산",
    storage: "ambient",
  });
  const outside = await service.addProduct(merchantB, {
    title: "다른 매장 상품",
    category: "fruit",
    unit: "1입",
    price: 1000,
    stock: 2,
    active: true,
    origin: "국내산",
    storage: "ambient",
  });
  const address = await service.addressCheck(customer, {
    storeId: a.id,
    regionId: dong.id,
    consent: true,
    addressBase: "대전 동구 홍도동 1",
  });
  const input = (overrides = {}) => ({
    storeId: a.id,
    regionId: dong.id,
    addressCheckId: address.id,
    idempotencyKey: uuid(),
    items: [{ productId: product.id, quantity: 2 }],
    customerName: "테스트 구매자",
    phone: "010-0000-0000",
    addressDetail: "테스트 상세주소",
    consent: true,
    expectedTotal: 12500,
    ...overrides,
  });
  await t.test(
    "city/district/dong rules, automatic location specificity, coarse-IP fallback and region-bound stores",
    async () => {
      assert.throws(() =>
        regionInput({
          name: "대전",
          province: "대전",
          city: "대전",
          cityType: "large",
          level: "city",
        }),
      );
      assert.equal(
        (await service.resolveLocation({}, { city: "gongju" })).region.id,
        small.id,
      );
      assert.equal(
        (await service.resolveLocation({}, { city: "daejeon" })).region,
        null,
      );
      const precise = await service.resolveLocation(
        { latitude: 36.3, longitude: 127.4, consent: true },
        {},
      );
      assert.equal(precise.region.id, dong.id);
      assert.equal((await service.publicStores(dong.id))[0].id, a.id);
      assert.equal((await service.publicStores(small.id))[0].id, b.id);
      await assert.rejects(() =>
        service.resolveLocation({ latitude: 36, longitude: 127 }, {}),
      );
    },
  );
  await t.test(
    "account verification, forged roles and merchant ownership are enforced",
    async () => {
      await assert.rejects(
        () =>
          service.login({ username: "merchant-a", password: "wrong" }, "bad"),
        { status: 401 },
      );
      await assert.rejects(() => service.addProduct(customer, {}), {
        status: 403,
      });
      await assert.rejects(() => service.removeProduct(merchantB, product.id), {
        status: 403,
      });
      assert.equal(await service.session("forged-token"), null);
    },
  );
  await t.test(
    "atomic stock reservation, request replay and mixed-store protection",
    async () => {
      const body = input(),
        created = await service.createOrder(customer, body),
        replayed = await service.createOrder(customer, body);
      assert.equal(created.id, replayed.id);
      assert.equal(created.total, 12500);
      assert.equal((await service.products(a.id))[0].stock, 8);
      await assert.rejects(
        () => service.createOrder(customer, { ...body, phone: "01011112222" }),
        { status: 409 },
      );
      await assert.rejects(
        () =>
          service.createOrder(
            customer,
            input({ items: [{ productId: outside.id, quantity: 1 }] }),
          ),
        { status: 409 },
      );
      assert.equal((await service.orders(other)).length, 0);
      const cancelled = await service.action(customer, created.id, {
        version: created.version,
        action: "cancel",
        note: "테스트 취소",
      });
      assert.equal(cancelled.status, "cancelled");
      assert.equal((await service.products(a.id))[0].stock, 10);
      await assert.rejects(
        () =>
          service.action(customer, created.id, {
            version: cancelled.version,
            action: "cancel",
            note: "재시도",
          }),
        { status: 403 },
      );
      assert.equal((await service.products(a.id))[0].stock, 10);
    },
  );
  await t.test(
    "seller preparation, regional dispatch, assigned pickup and delivery-code proof remain separate from payment",
    async () => {
      let o = await service.createOrder(customer, input());
      await assert.rejects(
        () =>
          service.action(merchantB, o.id, {
            version: o.version,
            action: "accept",
          }),
        { status: 403 },
      );
      await assert.rejects(
        () =>
          service.action(riderA, o.id, {
            version: o.version,
            action: "pickup",
          }),
        { status: 403 },
      );
      for (const action of ["accept", "prepare", "ready"])
        o = await service.action(merchantA, o.id, {
          version: o.version,
          action,
        });
      const queue = (await service.orders(riderA)).find((x) => x.id === o.id);
      assert.equal(queue.phone, undefined);
      assert.equal(queue.addressBase, undefined);
      assert.equal(queue.deliveryCode, undefined);
      await assert.rejects(
        () =>
          service.action(riderB, o.id, { version: o.version, action: "claim" }),
        { status: 403 },
      );
      o = await service.action(riderA, o.id, {
        version: o.version,
        action: "claim",
      });
      assert(o.addressBase);
      await assert.rejects(
        () =>
          service.action(riderB, o.id, {
            version: o.version,
            action: "pickup",
          }),
        { status: 403 },
      );
      o = await service.action(riderA, o.id, {
        version: o.version,
        action: "pickup",
      });
      await assert.rejects(
        () =>
          service.action(customer, o.id, {
            version: o.version,
            action: "cancel",
            note: "배송 중 취소",
          }),
        { status: 403 },
      );
      const real = (await service.orders(customer)).find(
          (x) => x.id === o.id,
        ).deliveryCode,
        wrong = real === "0000" ? "1111" : "0000";
      const denied = await service.action(riderA, o.id, {
        version: o.version,
        action: "deliver",
        deliveryCode: wrong,
      });
      assert.equal(denied.status, 409);
      o = (await service.orders(riderA)).find((x) => x.id === o.id);
      o = await service.action(riderA, o.id, {
        version: o.version,
        action: "deliver",
        deliveryCode: real,
      });
      assert.equal(o.status, "delivered");
      assert.equal(o.paymentState, "unverified");
      assert.equal(o.deliveryCode, undefined);
      assert.equal(
        (await service.orders(customer)).find((x) => x.id === o.id)
          .deliveryCode,
        real,
      );
    },
  );
  await t.test(
    "foreign seller cannot expire an order, and price or stock edits cannot alter existing order snapshots",
    async () => {
      const o = await service.createOrder(customer, input());
      await pool.query(
        "UPDATE market_orders SET expires_at=now()-interval '1 minute' WHERE id=$1",
        [o.id],
      );
      const stock = (await service.products(a.id))[0].stock;
      await assert.rejects(
        () =>
          service.action(merchantB, o.id, {
            version: o.version,
            action: "accept",
          }),
        { status: 403 },
      );
      assert.equal(
        (await service.orders(customer)).find((x) => x.id === o.id).status,
        "new",
      );
      assert.equal((await service.products(a.id))[0].stock, stock);
      await assert.rejects(
        () =>
          service.updateProduct(merchantB, product.id, {
            price: 6000,
            stock: 8,
            active: true,
          }),
        { status: 403 },
      );
      await service.updateProduct(merchantA, product.id, {
        price: 6000,
        stock: stock,
        active: true,
      });
      assert.equal(
        (await service.orders(customer)).find((x) => x.id === o.id).total,
        12500,
      );
      await service.expire();
      await service.updateProduct(merchantA, product.id, {
        price: 5000,
        stock: 10,
        active: true,
      });
    },
  );
  await t.test(
    "operator password-only login and password rotation invalidate prior sessions",
    async () => {
      const result = await service.login(
        { role: "operator", password: env("ARIRANG_MARKET_OPERATOR_PASSWORD") },
        "operator-test",
      );
      assert.equal((await service.session(result.token)).role, "operator");
      const rotated = makeMarketService(pool, {
        env: (k) =>
          k === "ARIRANG_MARKET_OPERATOR_PASSWORD"
            ? "rotated-test-password-123"
            : env(k),
      });
      assert.equal(await rotated.session(result.token), null);
    },
  );
  await t.test("reservation expiry restores stock exactly once", async () => {
    const before = (await service.products(a.id))[0].stock,
      o = await service.createOrder(customer, input());
    await pool.query(
      "UPDATE market_orders SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [o.id],
    );
    assert.equal((await service.expire()).expired, 1);
    assert.equal((await service.expire()).expired, 0);
    assert.equal((await service.products(a.id))[0].stock, before);
  });
  await t.test(
    "50-product and 100-vendor limits are enforced inside transactions",
    async () => {
      for (let i = 1; i < 50; i++)
        await service.addProduct(merchantA, {
          title: "한도 상품 " + i,
          category: "fruit",
          unit: "1입",
          price: 100,
          stock: 1,
          active: false,
          origin: "등록 정보",
          storage: "ambient",
        });
      await assert.rejects(
        () =>
          service.addProduct(merchantA, {
            title: "51번째",
            category: "fruit",
            unit: "1입",
            price: 100,
            stock: 1,
            origin: "등록 정보",
            storage: "ambient",
          }),
        { status: 409 },
      );
      const list = await service.products(a.id, merchantA);
      await service.removeProduct(
        merchantA,
        list.find((x) => x.id !== product.id).id,
      );
      await service.addProduct(merchantA, {
        title: "빈자리 상품",
        category: "fruit",
        unit: "1입",
        price: 100,
        stock: 1,
        origin: "등록 정보",
        storage: "ambient",
      });
      await pool.query("UPDATE market_capacity SET vendor_count=99 WHERE id=1");
      const create = () =>
        service.createStore(op, {
          name: "정원 경계 매장",
          regionId: small.id,
          address: "테스트 주소",
          deliveryFee: 0,
          minimumOrder: 0,
        });
      const results = await Promise.allSettled([create(), create()]);
      assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal((await service.adminData(op)).vendorCount, 100);
    },
  );
  assert(fetches >= 2);
  await db.close();
});
