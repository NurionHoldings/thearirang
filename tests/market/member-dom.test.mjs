import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "esbuild";
import { PGlite } from "@electric-sql/pglite";
import { makeMarketService } from "../../netlify/functions/_market/service.mjs";
import { makeMemberService } from "../../netlify/functions/_market/member.mjs";
import { marketHandler } from "../../netlify/functions/market.mjs";
const wait = async (p) => {
  for (let i = 0; i < 150; i++) {
    if (p()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("member UI state did not settle");
};
test("member login, address registration, edit, default reuse and logout through real scoped address service", async () => {
  const db = new PGlite();
  let dom;
  try {
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
    let user = null;
    const service = {
        ...makeMarketService(pool),
        members: makeMemberService(pool),
      },
      handler = marketHandler(
        () => service,
        () => undefined,
        async () => user,
      ),
      vc = new VirtualConsole(),
      errors = [];
    vc.on("jsdomError", (e) => errors.push(e.message));
    dom = new JSDOM(readFileSync("public/arirang-market.html", "utf8"), {
      url: "https://example.test/arirang-market.html#member",
      runScripts: "outside-only",
      virtualConsole: vc,
    });
    const w = dom.window,
      d = w.document,
      q = (s) => d.querySelector(s);
    w.setInterval = () => 0;
    w.confirm = () => true;
    w.ARIRANG_MEMBER_AUTH = {
      ready: Promise.resolve({ disableSignup: false }),
      async login() {
        user = {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "테스트 회원",
          email: "a@example.test",
        };
      },
      async logout() {
        user = null;
      },
      getUser: async () => user,
      signup: async () => {},
      updateUser: async () => {},
      requestPasswordRecovery: async () => {},
    };
    w.fetch = async (path, o = {}) =>
      handler(
        new Request(new URL(path, w.location.href), {
          ...o,
          headers: { ...o.headers, Origin: w.location.origin },
        }),
        { ip: "dom-member", geo: { city: "daejeon" } },
      );
    const code = await build({
      entryPoints: ["public/arirang-local.js"],
      bundle: true,
      format: "iife",
      write: false,
    });
    w.eval(code.outputFiles[0].text);
    await wait(() => q("#memberLogin"));
    const f = q("#memberLogin");
    f.elements.email.value = "a@example.test";
    f.elements.password.value = "test-password-123";
    f.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await wait(() => q("#newDeliveryAddress"));
    q("#newDeliveryAddress").click();
    let a = q("#addressBookForm");
    Object.entries({
      label: "집",
      recipientName: "테스트 회원",
      phone: "01000000000",
      addressBase: "대전 동구 홍도로 11",
      addressDetail: "101호",
    }).forEach(([k, v]) => (a.elements[k].value = v));
    a.elements.consent.checked = true;
    a.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await wait(() => q(".saved-address"));
    assert(q(".saved-address").textContent.includes("주소 확인 대기"));
    assert(q(".saved-address").textContent.includes("101호"));
    assert(!w.localStorage.getItem("arirang-local-basket")?.includes("101호"));
    q("[data-edit-address]").click();
    a = q("#addressBookForm");
    assert.equal(a.elements.addressDetail.value, "101호");
    a.elements.addressDetail.value = "202호";
    a.elements.consent.checked = true;
    a.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await wait(() => q(".saved-address")?.textContent.includes("202호"));
    q("[data-select-address]").click();
    await wait(() => q(".delivery-address-link"));
    assert(q(".delivery-address-link").textContent.includes("홍도로 11"));
    w.location.hash = "#member";
    await wait(() => q("#memberLogout"));
    q("#memberLogout").click();
    await wait(() => q("#memberLogin"));
    assert(!d.body.textContent.includes("202호"));
    assert.deepEqual(errors, []);
  } finally {
    dom?.window.close();
    await db.close();
  }
});
test("every public HTML page includes readability overrides and the home spotlight precedes floor content without duplication", () => {
  for (const f of readdirSync("public").filter((f) => f.endsWith(".html"))) {
    assert(
      readFileSync("public/" + f, "utf8").includes('href="readability.css"'),
      f,
    );
  }
  const home = readFileSync("public/index.html", "utf8");
  assert.equal((home.match(/id="online-market"/g) || []).length, 1);
  assert(home.indexOf('id="online-market"') < home.indexOf('id="workspace"'));
  assert(home.includes("아리랑마켓 바로가기"));
  assert(
    readFileSync("public/readability.css", "utf8").includes("@media screen"),
  );
});
