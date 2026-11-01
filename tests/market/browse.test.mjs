import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { makeMarketService } from "../../netlify/functions/_market/service.mjs";
import {
  normalizeBrowse,
  filterProducts,
  departments,
  categoryNames,
  validLeaf,
} from "../../public/market-taxonomy.mjs";
test("three-level paths, conflicting/unknown URLs, multi-term search and stable sorting", () => {
  const rows = [
    {
      id: 1,
      category: "fruit",
      subcategory: "apple-pear",
      title: "사과",
      origin: "국내산",
      price: 5000,
    },
    {
      id: 2,
      category: "vegetables",
      subcategory: "root",
      title: "당근",
      origin: "국내산",
      price: 2000,
    },
    {
      id: 3,
      category: "fruit",
      subcategory: "",
      title: "사과 미분류",
      price: 1000,
    },
  ];
  assert.deepEqual(
    normalizeBrowse({ major: "meals", category: "fruit", leaf: "pork" }),
    {
      major: "fresh",
      category: "fruit",
      leaf: "",
      search: "",
      sort: "recommended",
    },
  );
  assert.equal(
    normalizeBrowse({ major: "<img>", category: "unknown", leaf: "bad" }).major,
    "all",
  );
  assert.equal(
    filterProducts(rows, { category: "fruit", leaf: "apple-pear" })[0].id,
    1,
  );
  assert.equal(
    filterProducts(rows, { category: "fruit", leaf: "apple-pear" }).length,
    1,
  );
  assert.equal(filterProducts(rows, { search: "사과 국내산" }).length, 1);
  assert.equal(filterProducts(rows, { sort: "price-asc" })[0].id, 3);
  assert.equal(rows[0].id, 1);
  assert(!validLeaf("fruit", "pork"));
  assert.equal(
    new Set(departments.flatMap((d) => d.categories)).size,
    Object.keys(categoryNames).length,
  );
});
test("catalog only returns public, active stores in the selected service region; leaf persistence and validation", async () => {
  const db = new PGlite();
  try {
    for (const name of readdirSync("netlify/database/migrations").sort())
      await db.exec(
        readFileSync("netlify/database/migrations/" + name, "utf8"),
      );
    const pool = {
        query: (q, p) => db.query(q, p),
        connect: async () => ({
          query: (q, p) => db.query(q, p),
          release() {},
        }),
      },
      s = makeMarketService(pool),
      op = { id: "operator", role: "operator" },
      r = "11111111-1111-4111-8111-111111111112";
    const a = await s.createStore(op, {
      name: "테스트 공개 매장",
      regionId: r,
      address: "대전 동구",
      deliveryFee: 2500,
      minimumOrder: 0,
    });
    const b = await s.createStore(op, {
      name: "테스트 미승인 매장",
      regionId: r,
      address: "대전 동구",
      deliveryFee: 0,
      minimumOrder: 0,
    });
    await s.storeState(op, a.id, { status: "active", open: true });
    const product = {
      title: "사과",
      category: "fruit",
      subcategory: "apple-pear",
      unit: "3입",
      origin: "국내산",
      price: 5000,
      stock: 5,
      active: true,
      storage: "ambient",
    };
    await s.addProduct(op, { ...product, storeId: a.id });
    await s.addProduct(op, { ...product, storeId: b.id });
    await s.addProduct(op, { ...product, storeId: a.id, active: false });
    await assert.rejects(() =>
      s.addProduct(op, { ...product, storeId: a.id, subcategory: "pork" }),
    );
    const rows = await s.catalog(r);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subcategory, "apple-pear");
    assert.equal(rows[0].storeName, "테스트 공개 매장");
    assert(!("password_hash" in rows[0]));
    assert.equal(
      (await s.catalog("11111111-1111-4111-8111-111111111113")).length,
      0,
    );
    await s.availability(
      { id: "test", role: "merchant", storeId: a.id },
      false,
    );
    assert.equal((await s.catalog(r)).length, 0);
  } finally {
    await db.close();
  }
});
