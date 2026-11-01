import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "esbuild";
const region = {
  id: "11111111-1111-4111-8111-111111111112",
  name: "대전 동구 홍도동",
  province: "대전",
  city: "대전",
  district: "동구",
  dong: "홍도동",
  level: "dong",
  active: true,
};
const store = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "우리 동네 매장",
  address: "대전 동구",
  deliveryFee: 2500,
  minimumOrder: 0,
};
const products = [
  {
    id: "33333333-3333-4333-8333-333333333331",
    store_id: store.id,
    storeName: store.name,
    title: "우리 사과",
    category: "fruit",
    subcategory: "apple-pear",
    origin: "국내산",
    unit: "3입",
    price: 5000,
    stock: 4,
    storage: "ambient",
    description: "달콤한 사과",
  },
  {
    id: "33333333-3333-4333-8333-333333333332",
    store_id: store.id,
    storeName: store.name,
    title: "감귤",
    category: "fruit",
    subcategory: "citrus",
    origin: "국내산",
    unit: "1kg",
    price: 6000,
    stock: 3,
    storage: "ambient",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    store_id: store.id,
    storeName: store.name,
    title: "당근",
    category: "vegetables",
    subcategory: "root",
    origin: "국내산",
    unit: "1입",
    price: 2000,
    stock: 3,
    storage: "chilled",
  },
];
const wait = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("DOM state did not settle");
};
async function setup(hash = "", catalog = products) {
  const errors = [],
    vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  const d = new JSDOM(readFileSync("public/arirang-local.html", "utf8"), {
    url: "https://example.test/arirang-local.html" + hash,
    runScripts: "outside-only",
    virtualConsole: vc,
  });
  const w = d.window;
  w.setInterval = () => 0;
  w.confirm = () => true;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.fetch = async (path) => {
    const u = new URL(path, w.location.href);
    let data;
    if (u.pathname.endsWith("/config")) data = { liveOrders: false };
    else if (u.pathname.endsWith("/session"))
      data = { staff: null, customer: null };
    else if (u.pathname.endsWith("/regions")) data = [region];
    else if (u.pathname.endsWith("/location"))
      data = { region, source: "geolocation" };
    else if (u.pathname.endsWith("/stores")) data = [store];
    else if (u.pathname.endsWith("/catalog")) data = catalog;
    else if (u.pathname.endsWith("/products")) data = catalog;
    else throw Error("unexpected path " + path);
    return { ok: true, json: async () => structuredClone(data) };
  };
  const bundle = await build({
    entryPoints: ["public/arirang-local.js"],
    bundle: true,
    format: "iife",
    write: false,
  });
  w.eval(bundle.outputFiles[0].text);
  await wait(() => w.document.querySelector(".product-card, .leaf-preview-card"));
  return {
    d,
    w,
    q: (s) => w.document.querySelector(s),
    all: (s) => [...w.document.querySelectorAll(s)],
    errors,
  };
}
test("home is compact; hierarchical narrowing hides promotions; detail/back preserves search; cart and home work", async () => {
  const { d, w, q, all, errors } = await setup();
  try {
    assert.equal(all(".specialty-halls").length, 1);
    assert.equal(all(".middle-category-images img").length, 13);
    assert.equal(all(".category-showcase").length, 0);
    assert(q('[data-browse-category="fruit"] img').getAttribute("src").includes("fruit-v1.webp"));
    assert.equal(all(".product-card").length, 3);
    q("[data-browse-major=fresh]").click();
    assert.equal(all(".specialty-halls").length, 0);
    assert.equal(all(".middle-category-images img").length, 4);
    q("[data-browse-category=fruit]").click();
    q("[data-browse-leaf=apple-pear]").click();
    assert.equal(all(".product-card").length, 1);
    assert(w.location.search.includes("leaf=apple-pear"));
    q("[data-detail]").click();
    assert.equal(q("#productDetail").hasAttribute("open"), true);
    assert.equal(all(".detail-tabs button").length,3);
    assert(q("#detailOverview").textContent.includes("국내산"));
    assert(q(".detail-price").textContent.includes("5,000원"));
    q("[data-close-detail]").click();
    assert.equal(all(".product-card").length, 1);
    assert.equal(
      q("[data-browse-leaf=apple-pear]").getAttribute("aria-pressed"),
      "true",
    );
    q("[data-customer-view=shop]").click();
    await wait(() => all(".product-card").length === 3);
    q("#marketSearchInput").value = "사과";
    q("#marketSearch").dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
    assert.equal(all(".product-card").length, 1);
    assert.equal(all(".market-intro").length, 0);
    q("[data-add]").click();
    await wait(() => q("#basketCount").textContent === "1");
    q("[data-customer-view=cart]").click();
    await wait(() => q(".basket-row"));
    assert(q(".basket-row").textContent.includes("우리 사과"));
    assert(!q("#checkoutForm"));
    assert(q(".checkout-preparing").textContent.includes("카드결제"));
    q("[data-customer-view=categories]").click();
    await wait(() => q(".browse-title"));
    assert(q("#categoryBrowser"));
    assert.equal(all(".specialty-halls").length, 0);
    assert.deepEqual(errors, []);
  } finally {
    d.window.close();
  }
});
test("direct category/search links and sort state survive reload and browser history", async () => {
  const { d, w, q, all, errors } = await setup(
    "?major=fresh&category=fruit&leaf=citrus&q=감귤&sort=price-asc#shop",
  );
  try {
    assert.equal(all(".product-card").length, 1);
    assert.equal(q("#marketSearchInput").value, "감귤");
    assert.equal(q("#productSort").value, "price-asc");
    assert(q(".product-card h3").textContent.includes("감귤"));
    assert.equal(all(".specialty-halls").length, 0);
    w.history.pushState({}, "", "?category=vegetables#shop");
    w.dispatchEvent(new w.PopStateEvent("popstate"));
    await wait(() => q(".product-card h3")?.textContent === "당근");
    assert.equal(q("#marketSearchInput").value, "");
    assert.deepEqual(errors, []);
  } finally {
    d.window.close();
  }
});

 test("final subcategory opens the product showcase from category navigation", async () => {
  const { d, w, q, all, errors } = await setup();
  try {
    q("[data-customer-view=categories]").click();
    await wait(() => q(".browse-title"));
    q("[data-browse-major=fresh]").click();
    q("[data-browse-category=fruit]").click();
    q("[data-browse-leaf=apple-pear]").click();
    assert.equal(w.location.hash, "#shop");
    assert.equal(all(".product-card").length, 1);
    assert(q(".product-card").textContent.includes("우리 사과"));
    assert.equal(new URLSearchParams(w.location.search).get("leaf"), "apple-pear");
    assert.equal(q(".browse-title"), null);
    await wait(() => w.document.activeElement === q("#catalogTitle"));
    w.history.back();
    await wait(() => q(".browse-title"));
    q('[data-browse-leaf=""]').click();
    assert.equal(w.location.hash, "#shop");
    assert.equal(all(".product-card").length, 2);
    assert.deepEqual(errors, []);
  } finally { d.window.close(); }
});

 test("empty catalog presents retail mockups, never synthetic purchasable inventory", async () => {
 const {d,w,q,all,errors}=await setup("",[]);
 try {
 assert.equal(all(".leaf-preview-card").length,46);
 assert.equal(all(".product-card").length,0);
 assert.equal(all(".leaf-preview-card [data-add]").length,0);
 assert(q(".leaf-preview-heading").textContent.includes("실제 판매상품 등록"));
 q('[data-preview-category="fruit"][data-preview-leaf="apple-pear"]').click();
 assert.equal(all(".leaf-preview-card").length,1);
 assert(q(".leaf-preview-card h3").textContent.includes("사과 팩"));
 assert(q(".leaf-preview-card img").src.endsWith("fruit--apple-pear-retail-v2.webp"));
 assert(w.location.search.includes("leaf=apple-pear"));
 assert(q("#productDetail").hasAttribute("open"));
 assert(q("#detailTitle").textContent.includes("사과 팩"));
 assert.equal(all("#productDetail [data-add]").length,0);
 assert(q("#productDetail .primary").disabled);
 assert.equal(all(".detail-tabs button").length,3);
 q("[data-close-detail]").click();
 assert.equal(q("#productDetail"),null);
 assert.equal(all(".leaf-preview-card").length,1);
 assert.deepEqual(errors,[]);
 }finally{d.window.close()}
 });
