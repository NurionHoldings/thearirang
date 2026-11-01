import {categoryImage,displayImage,generatedImage,imageCategories,leafEntries,matchingLeafImages} from "./market-images.mjs";
import {
  departments,
  categoryNames,
  leaves,
  departmentFor,
  leafName,
  normalizeBrowse,
  filterProducts,
} from "./market-taxonomy.mjs";
const API = "/market-api",
  root = document.getElementById("localContent"),
  feedback = document.getElementById("marketFeedback");
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원",
  uid = () => crypto.randomUUID();
const statuses = {
  new: "업체 접수 대기",
  accepted: "주문 접수",
  preparing: "상품 준비 중",
  ready: "픽업 준비 완료",
  picked_up: "배송 중",
  delivered: "배송 완료",
  cancelled: "취소",
  rejected: "업체 거절",
};
const state = {
  config: {},
  member: null,
  addresses: [],
  selectedAddressId: null,
  addressEdit: null,
  memberSettings: null,
  authError: "",
  recovery: false,
  regions: [],
  stores: [],
  products: [],
  catalog: [],
  major: "all",
  leaf: "",
  sort: "recommended",
  filterStore: false,
  detail: null,
  staff: null,
  customer: null,
  ops: null,
  orders: [],
  region: null,
  store: null,
  basket: {},
  category: "all",
  search: "",
  address: null,
  checkoutKey: null,
  credential: null,
  locationNote: "지역을 선택하거나 내 위치로 연결해 주세요.",
  connected: false,
};
try {
  const raw = JSON.parse(localStorage.getItem("arirang-local-basket") || "{}");
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof raw.storeId === "string" &&
    typeof raw.regionId === "string" &&
    raw.items &&
    typeof raw.items === "object"
  )
    state.savedBasket = raw;
} catch {}
const view = () =>
  [
    "shop",
    "categories",
    "cart",
    "orders",
    "member",
    "addresses",
    "staff",
    "operations",
  ].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "shop";
function readBrowse() {
  const q = new URLSearchParams(location.search);
  Object.assign(
    state,
    normalizeBrowse({
      major: q.get("major"),
      category: q.get("category"),
      leaf: q.get("leaf"),
      search: q.get("q"),
      sort: q.get("sort"),
    }),
  );
}
readBrowse();
function saveBrowse(replace = false, hash = null) {
  const u = new URL(location.href);
  if (hash !== null) u.hash = hash;
  for (const [k, v] of Object.entries({
    major: state.major,
    category: state.category,
    leaf: state.leaf,
    q: state.search,
    sort: state.sort,
    region: state.region?.id || "",
  })) {
    if (v && v !== "all" && v !== "recommended") u.searchParams.set(k, v);
    else u.searchParams.delete(k);
  }
  history[replace ? "replaceState" : "pushState"]({}, "", u);
}
function setBrowse(value, showResults = false) {
  Object.assign(state, normalizeBrowse({ ...state, ...value }));
  state.detail = null;
  saveBrowse(false, showResults ? "shop" : null);
  render();
  if (showResults) {
    const schedule = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
    schedule(() => {
      const title = root.querySelector("#catalogTitle");
      title?.scrollIntoView?.({ block: "start", behavior: "instant" });
      title?.focus({ preventScroll: true });
    });
  }
}
function results() {
  return filterProducts(
    state.filterStore && state.store
      ? state.catalog.filter((p) => p.store_id === state.store.id)
      : state.catalog,
    state,
  );
}
function selectedDelivery() {
  return (
    state.addresses.find((a) => a.id === state.selectedAddressId) ||
    state.addresses.find((a) => a.is_default) ||
    null
  );
}
async function refreshMember(sync = false) {
  if (!window.ARIRANG_MEMBER_AUTH) return;
  const result = sync
    ? await post("/member/session", {})
    : await api("/member/me");
  state.member = result.member;
  state.addresses = result.addresses || [];
  state.selectedAddressId = result.selectedAddressId;
  state.customer = state.member
    ? { id: state.member.id, role: "customer", member: true }
    : null;
}
async function applyDelivery() {
  const a = selectedDelivery();
  if (!a) return;
  if (a.region_id && state.regions.some((r) => r.id === a.region_id)) {
    if (state.region?.id !== a.region_id)
      await chooseRegion(a.region_id, false);
  } else {
    state.region = null;
    state.store = null;
    state.products = [];
    state.catalog = [];
    state.stores = [];
    state.basket = {};
    resetCheckout();
  }
  render();
}
function memberView() {
  if (state.member && !state.recovery)
    return `<section class="member-panel"><p class="eyebrow">MY ARIRANG MARKET</p><h1>${e(state.member.name || "회원")}님, 반갑습니다.</h1><p>${e(state.member.email)}</p><div class="member-actions"><a class="primary-link" href="#addresses">배송지 관리 (${state.addresses.length}/10)</a><a href="#orders">내 주문</a><button id="memberLogout">로그아웃</button></div><p class="muted">배송지는 계정에 저장되어 로그인한 기기에서 다시 사용할 수 있습니다.</p></section>`;
  const auth = window.ARIRANG_MEMBER_AUTH,
    settings = state.memberSettings;
  if (!auth || state.authError)
    return `<section class="member-panel"><h1>회원 연결 확인이 필요합니다.</h1><p>${e(state.authError || "회원 기능을 연결하고 있습니다. 잠시 후 새로고침해 주세요.")}</p></section>`;
  if (state.recovery)
    return `<section class="member-panel"><h1>새 비밀번호 설정</h1><form id="memberRecovery"><label>새 비밀번호<input name="password" type="password" minlength="10" maxlength="128" required autocomplete="new-password"></label><button class="primary">비밀번호 변경</button></form></section>`;
  return `<section class="member-panel"><p class="eyebrow">WELCOME TO ARIRANG MARKET</p><h1>내 배송지로 편하게 장보기</h1><p>회원가입 후 집·회사 등 배송지를 미리 저장하세요.</p><form id="memberLogin"><h2>로그인</h2><label>이메일<input name="email" type="email" maxlength="254" required autocomplete="username"></label><label>비밀번호<input name="password" type="password" maxlength="128" required autocomplete="current-password"></label><button class="primary">로그인</button><button type="button" id="memberForgot">비밀번호 재설정 메일 받기</button></form><details class="member-signup"><summary>처음 오셨나요? 회원가입</summary>${settings?.disableSignup ? '<p class="membership-unavailable">현재 일반 회원가입을 준비 중입니다. 가입이 열리면 이 화면에서 바로 등록할 수 있습니다.</p>' : `<form id="memberSignup"><label>이름<input name="name" maxlength="40" required autocomplete="name"></label><label>이메일<input name="email" type="email" maxlength="254" required autocomplete="email"></label><label>비밀번호 (10자 이상)<input name="password" type="password" minlength="10" maxlength="128" required autocomplete="new-password"></label><label>비밀번호 확인<input name="confirm" type="password" minlength="10" maxlength="128" required autocomplete="new-password"></label><p class="muted">계정 인증에 이메일과 이름을 사용합니다. 배송지 정보는 가입 후 주소록에서 별도로 등록합니다.</p><button class="primary">가입하고 이메일 인증하기</button></form>`}</details></section>`;
}
function addressesView() {
  if (!state.member)
    return `<section class="member-panel"><h1>배송주소를 미리 저장하세요.</h1><p>회원 로그인 후 배송지 주소록을 이용할 수 있습니다.</p><a class="primary-link" href="#member">로그인·회원가입</a></section>`;
  const editing =
    state.addressEdit === "new"
      ? {}
      : state.addresses.find((a) => a.id === state.addressEdit);
  return `<section class="address-book"><div class="catalog-heading"><h1>배송지 관리 <small>${state.addresses.length}/10</small></h1><button id="newDeliveryAddress"${state.addresses.length >= 10 ? " disabled" : ""}>+ 배송지 등록</button></div><p class="muted">선택한 배송지로 장보기 지역을 연결합니다. 주소·연락처·배송 요청은 공개 화면이나 이 브라우저 저장소에 보관하지 않습니다.</p>${editing ? `<form id="addressBookForm" class="form-grid"><h2 class="wide">${editing.id ? "배송지 수정" : "배송지 등록"}</h2><label>배송지 이름<input name="label" maxlength="30" required placeholder="집 / 회사" value="${e(editing.label)}"></label><label>받는 분<input name="recipientName" maxlength="40" required autocomplete="name" value="${e(editing.recipient_name || state.member.name)}"></label><label>휴대전화<input name="phone" maxlength="20" required inputmode="tel" autocomplete="tel" value="${e(editing.phone)}"></label><label>우편번호 (선택)<input name="postalCode" maxlength="5" inputmode="numeric" autocomplete="postal-code" value="${e(editing.postal_code)}"></label><label class="wide">도로명 또는 지번 주소<input name="addressBase" maxlength="200" required autocomplete="address-line1" placeholder="시·구·도로명과 건물번호까지 입력" value="${e(editing.address_base)}"></label><label class="wide">상세주소<input name="addressDetail" maxlength="200" required autocomplete="address-line2" placeholder="건물명 · 동·호수" value="${e(editing.address_detail)}"></label><label class="wide">배송 요청 (선택)<textarea name="deliveryNote" maxlength="300">${e(editing.delivery_note)}</textarea></label><label class="check"><input name="isDefault" type="checkbox"${editing.is_default || !state.addresses.length ? " checked" : ""}> 기본 배송지로 사용</label><label class="check wide"><input name="consent" type="checkbox" required> 이름·연락처·주소·요청사항을 내 계정에 저장하는 것을 확인했습니다.</label><p class="muted wide">주소 확인 서비스 연결 전에는 미확인 상태로 저장됩니다. 미확인 주소는 배송 가능으로 표시하지 않습니다.</p><div class="member-actions wide"><button class="primary">배송지 저장</button><button type="button" id="cancelAddressEdit">취소</button></div></form>` : ""}<div class="address-list">${state.addresses.map((a) => `<article class="saved-address"><div class="catalog-heading"><h2>${e(a.label)} ${a.is_default ? '<span class="address-badge">기본</span>' : ""}${a.id === state.selectedAddressId ? '<span class="address-badge selected">선택 중</span>' : ""}</h2><button data-edit-address="${a.id}">수정</button></div><p>${e(a.recipient_name)} · ${e(a.phone)}</p><p>${e(a.address_base)} ${e(a.address_detail)}</p>${a.delivery_note ? `<p class="muted">배송 요청: ${e(a.delivery_note)}</p>` : ""}<p class="address-verification">${!a.verified_at ? "주소 확인 대기" : a.region_id ? "주소 확인 완료 · 등록 배송구역 연결" : "주소 확인 완료 · 현재 서비스 구역 외"}</p><div class="member-actions"><button data-select-address="${a.id}">${a.id === state.selectedAddressId ? "현재 배송지" : "이 주소로 장보기"}</button>${!a.is_default ? `<button data-default-address="${a.id}">기본 배송지로</button>` : ""}<button data-delete-address="${a.id}" data-version="${a.version}">삭제</button></div></article>`).join("") || '<div class="catalog-empty"><h2>등록된 배송지가 없습니다.</h2><p>집이나 회사 주소를 한 번 등록해 두세요.</p></div>'}</div><p><a href="#shop">← 장보기로 돌아가기</a></p></section>`;
}
function bindMember() {
  const auth = window.ARIRANG_MEMBER_AUTH;
  root.querySelector("#memberLogin")?.addEventListener(
    "submit",
    run(async (ev) => {
      const f = ev.target,
        b = f.querySelector("button");
      b.disabled = true;
      try {
        await auth.login(
          f.elements.email.value.trim(),
          f.elements.password.value,
        );
        f.reset();
        await refreshMember(true);
        await applyDelivery();
        location.hash = "#addresses";
      } finally {
        b.disabled = false;
      }
    }),
  );
  root.querySelector("#memberSignup")?.addEventListener(
    "submit",
    run(async (ev) => {
      const f = ev.target;
      if (f.elements.password.value !== f.elements.confirm.value)
        throw Error("비밀번호 확인이 일치하지 않습니다.");
      const b = f.querySelector("button");
      b.disabled = true;
      try {
        await auth.signup(
          f.elements.email.value.trim(),
          f.elements.password.value,
          { full_name: f.elements.name.value.trim() },
        );
        f.reset();
        if (await auth.getUser()) {
          await refreshMember(true);
          location.hash = "#addresses";
        } else {
          message(
            "인증 메일을 보냈습니다. 받은 메일의 링크를 확인한 뒤 로그인하세요.",
          );
          return "인증 메일의 링크를 확인한 뒤 로그인하세요.";
        }
      } finally {
        b.disabled = false;
      }
    }),
  );
  root.querySelector("#memberForgot")?.addEventListener(
    "click",
    run(async () => {
      const f = root.querySelector("#memberLogin"),
        email = f.elements.email;
      if (!email.reportValidity()) return;
      await auth.requestPasswordRecovery(email.value.trim());
      return "해당 계정이 있으면 비밀번호 재설정 안내가 발송됩니다.";
    }),
  );
  root.querySelector("#memberRecovery")?.addEventListener(
    "submit",
    run(async (ev) => {
      await auth.updateUser({ password: ev.target.elements.password.value });
      ev.target.reset();
      state.recovery = false;
      const u = new URL(location.href);
      u.searchParams.delete("memberRecovery");
      history.replaceState({}, "", u);
      await refreshMember(true);
      render();
    }),
  );
  root.querySelector("#memberLogout")?.addEventListener(
    "click",
    run(async () => {
      await auth.logout();
      state.member = null;
      state.customer = null;
      state.addresses = [];
      state.selectedAddressId = null;
      state.addressEdit = null;
      state.orders = [];
      state.detail = null;
      render();
    }),
  );
  root.querySelector("#newDeliveryAddress")?.addEventListener("click", () => {
    state.addressEdit = "new";
    render();
  });
  root.querySelector("#cancelAddressEdit")?.addEventListener("click", () => {
    state.addressEdit = null;
    render();
  });
  root.querySelectorAll("[data-edit-address]").forEach(
    (b) =>
      (b.onclick = () => {
        state.addressEdit = b.dataset.editAddress;
        render();
      }),
  );
  root.querySelector("#addressBookForm")?.addEventListener(
    "submit",
    run(async (ev) => {
      const f = ev.target,
        v = Object.fromEntries(new FormData(f)),
        old = state.addresses.find((a) => a.id === state.addressEdit);
      v.isDefault = f.elements.isDefault.checked;
      v.consent = f.elements.consent.checked;
      if (old) v.version = old.version;
      const b = f.querySelector("button[type=submit],button.primary");
      b.disabled = true;
      try {
        await api("/member/addresses" + (old ? "/" + old.id : ""), {
          method: old ? "PATCH" : "POST",
          body: JSON.stringify(v),
        });
        f.reset();
        state.addressEdit = null;
        await refreshMember();
        await applyDelivery();
        render();
      } finally {
        b.disabled = false;
      }
    }),
  );
  for (const [selector, suffix, key] of [
    ["[data-select-address]", "select", "selectAddress"],
    ["[data-default-address]", "default", "defaultAddress"],
  ])
    root.querySelectorAll(selector).forEach(
      (b) =>
        (b.onclick = run(async () => {
          if (
            Object.keys(state.basket).length &&
            !confirm(
              "배송지를 변경하면 현재 장바구니가 비워질 수 있습니다. 변경할까요?",
            )
          )
            return;
          await post("/member/addresses/" + b.dataset[key] + "/" + suffix, {});
          await refreshMember();
          await applyDelivery();
          state.addressEdit = null;
          location.hash = "#shop";
          render();
        })),
    );
  root.querySelectorAll("[data-delete-address]").forEach(
    (b) =>
      (b.onclick = run(async () => {
        if (!confirm("이 배송지를 삭제할까요?")) return;
        await api("/member/addresses/" + b.dataset.deleteAddress, {
          method: "DELETE",
          body: JSON.stringify({ version: Number(b.dataset.version) }),
        });
        await refreshMember();
        await applyDelivery();
        render();
      })),
  );
}
function message(text, error = false) {
  feedback.textContent = text;
  feedback.classList.toggle("error", error);
}
async function api(path, options = {}) {
  const response = await fetch(API + path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("서버 응답을 확인할 수 없습니다.");
  }
  if (!response.ok) throw Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}
const post = (path, data) =>
  api(path, { method: "POST", body: JSON.stringify(data) });
function options(rows, current = "", empty = "선택해 주세요") {
  return (
    `<option value="">${empty}</option>` +
    rows
      .map(
        (r) =>
          `<option value="${e(r.id)}"${r.id === current ? " selected" : ""}>${e(r.name)}</option>`,
      )
      .join("")
  );
}
function regionOptions(selected = "") {
  const groups = new Map();
  for (const r of state.regions) {
    const group = [r.province, r.city]
      .filter((x, i, a) => i === 0 || x !== a[0])
      .join(" ");
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(r);
  }
  return (
    '<option value="">시 / 구 / 동을 선택하세요</option>' +
    [...groups]
      .map(
        ([group, rows]) =>
          `<optgroup label="${e(group)}">${rows.map((r) => `<option value="${e(r.id)}"${selected === r.id ? " selected" : ""}>${e(r.name)} · ${r.level === "city" ? "시" : r.level === "district" ? "구" : "동"} 단위</option>`).join("")}</optgroup>`,
      )
      .join("")
  );
}
async function customerSession() {
  if (!state.customer)
    state.customer = (await post("/customer-session", {})).actor;
  return state.customer;
}
function saveBasket() {
  try {
    localStorage.setItem(
      "arirang-local-basket",
      JSON.stringify({
        storeId: state.store?.id || "",
        regionId: state.region?.id || "",
        items: state.basket,
      }),
    );
  } catch {
    message("장바구니를 이 브라우저에 저장하지 못했습니다.", true);
  }
}
function basketItems() {
  return state.products
    .filter(
      (p) => Number.isSafeInteger(state.basket[p.id]) && state.basket[p.id] > 0,
    )
    .map((p) => ({ ...p, quantity: state.basket[p.id] }));
}
function resetCheckout() {
  state.address = null;
  state.checkoutKey = null;
}
async function chooseRegion(id, manual = true) {
  const r = state.regions.find((r) => r.id === id);
  if (!r) return;
  if (
    manual &&
    Object.keys(state.basket).length &&
    !confirm("배송 지역을 바꾸면 장바구니가 비워집니다. 변경할까요?")
  ) {
    render();
    return;
  }
  const [stores, catalog] = await Promise.all([
    api("/stores?region=" + encodeURIComponent(id)),
    api("/catalog?region=" + encodeURIComponent(id)),
  ]);
  state.region = r;
  state.store = null;
  state.products = [];
  state.basket = {};
  state.stores = stores;
  state.filterStore = false;
  state.catalog = catalog;
  resetCheckout();
  if (manual) saveBrowse();
  if (manual)
    try {
      localStorage.setItem("arirang-delivery-region", id);
    } catch {}
  render();
}
async function locate(precise = false) {
  message("접속 지역을 확인하고 있습니다.");
  let data;
  if (precise) {
    if (!navigator.geolocation)
      throw Error("위치를 사용할 수 없습니다. 지역을 직접 선택하세요.");
    const p = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        resolve,
        () =>
          reject(Error("위치 권한을 확인하거나 지역을 직접 선택해 주세요.")),
        { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false },
      ),
    );
    data = await post("/location", {
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      consent: true,
    });
  } else data = await post("/location", {});
  if (data.region) {
    state.locationNote =
      data.source === "geolocation"
        ? "위치 동의 기반 " + data.region.name + " 연결"
        : "접속 IP의 시 단위 지역 연결";
    await chooseRegion(data.region.id, false);
    message(state.locationNote);
  } else {
    state.locationNote = data.candidates?.length
      ? "접속 도시는 확인됐습니다. 정확한 구·동을 선택하거나 내 위치 연결을 이용하세요."
      : "해당 접속 지역의 운영 구역을 확인하지 못했습니다. 지역을 직접 선택해 주세요.";
    render();
    message(state.locationNote);
  }
}
async function chooseStore(id) {
  const s = state.stores.find((s) => s.id === id);
  if (!s) return;
  if (
    state.store?.id !== id &&
    Object.keys(state.basket).length &&
    !confirm("업체를 바꾸면 현재 장바구니가 비워집니다. 변경할까요?")
  )
    return;
  if (state.store?.id === id) {
    state.filterStore = true;
    render();
    return;
  }
  const products = await api("/products?storeId=" + id);
  state.store = s;
  state.products = products;
  state.basket = {};
  if (
    state.savedBasket?.storeId === id &&
    state.savedBasket.regionId === state.region?.id
  ) {
    for (const p of state.products) {
      const qty = state.savedBasket.items[p.id];
      if (Number.isSafeInteger(qty) && qty > 0 && p.stock > 0)
        state.basket[p.id] = Math.min(qty, p.stock, 100);
    }
    state.savedBasket = null;
  }
  state.filterStore = true;
  resetCheckout();
  render();
}
function basketView() {
  const rows = basketItems(),
    subtotal = rows.reduce((a, p) => a + p.price * p.quantity, 0);
  return `<aside class="local-basket"><div class="section-title"><h2>이 업체 장바구니</h2><span>${rows.length}종 / 최대 50종</span></div>${rows.length ? rows.map((p) => `<div class="basket-row"><div><strong>${e(p.title)}</strong><small>${won(p.price)} · ${e(p.unit)}</small></div><div class="quantity"><button data-qty="${p.id}" data-delta="-1" aria-label="${e(p.title)} 수량 줄이기">−</button><span>${p.quantity}</span><button data-qty="${p.id}" data-delta="1" aria-label="${e(p.title)} 수량 늘리기"${p.quantity >= Math.min(p.stock, 100) ? " disabled" : ""}>+</button></div></div>`).join("") : '<p class="muted">한 업체의 상품을 담아 주세요.</p>'}<div class="basket-total"><span>상품 합계</span><b>${won(subtotal)}</b><span>업체 배송비</span><b>${won(state.store.deliveryFee)}</b><span>예상 합계</span><strong>${won(subtotal + state.store.deliveryFee)}</strong></div><p class="muted">최소 상품금액 ${won(state.store.minimumOrder)} · 현장결제 · 실제 결제 확인은 별도</p>${rows.length ? checkoutForm(subtotal) : ""}</aside>`;
}
function checkoutForm(subtotal) {
  return `<div class="checkout-preparing"><h3>카드결제 · 외부 배달대행</h3><p>결제·배달 서비스 연결을 준비하고 있습니다. 현재는 상품 탐색과 장바구니를 이용하실 수 있습니다.</p><button disabled>결제 연결 준비 중</button></div>`;
}
function categoryBrowser(compact = false) {
  const middle =
    state.major === "all"
      ? Object.keys(categoryNames)
      : departments.find((d) => d.id === state.major).categories;
  const chips = (label, rows, key, current) =>
    `<div class="category-level${key === "category" ? " category-image-level" : ""}"><span>${label}</span>${key === "category" ? '<small class="category-image-note">카테고리 대표 이미지 · AI 생성</small>' : ""}<div role="group" aria-label="${label}"${key === "category" ? ' class="middle-category-images"' : ""}>${rows.map(([id, name]) => `<button data-browse-${key}="${e(id)}" aria-pressed="${id === current}"${key === "category" ? ' class="middle-category-card"' : ""}>${key === "category" && id !== "all" ? `<img src="${categoryImage(id)}" alt="" width="960" height="720" loading="lazy">` : ""}<span>${e(name)}</span></button>`).join("")}</div></div>`;
  return `<section id="categoryBrowser" class="category-browser" aria-label="3단계 상품 분류">${compact ? "" : chips("대분류", [["all", "전체"], ...departments.map((d) => [d.id, d.name])], "major", state.major)}${chips("중분류", [["all", "전체"], ...middle.map((id) => [id, categoryNames[id]])], "category", state.category)}${state.category !== "all" ? chips("소분류", [["", "전체"], ...leaves[state.category]], "leaf", state.leaf) : '<p class="category-hint">중분류를 선택하면 소분류가 열립니다.</p>'}</section>`;
}
function leafPreviewGallery(){const entries=matchingLeafImages(state);if(!entries.length)return '';return `<section class="leaf-preview-gallery" aria-label="소분류 품목 이미지"><div class="leaf-preview-heading"><h3>소분류 품목 이미지 <small>${entries.length}종</small></h3><p>AI로 생성한 판매상품 이미지 예시입니다. 실제 판매상품 등록 후 사진·가격·재고가 표시됩니다.</p></div><div class="leaf-preview-grid">${entries.map(x=>`<article class="leaf-preview-card"><button data-preview-category="${x.category}" data-preview-leaf="${x.id}" aria-label="${e(x.name)} 품목 보기"><img src="${x.src}" alt="${e(x.title)} ${e(x.unit)} 포장 상품 이미지 예시" width="640" height="640" loading="lazy"><span class="leaf-preview-category">${e(categoryNames[x.category])}</span><h3>${e(x.title)} <span>${e(x.unit)}</span></h3><small>AI 상품 예시 · 판매 준비 중</small></button></article>`).join('')}</div></section>`}
function productImage(p){const real=p.image_url&&!generatedImage(p.image_url);return `<span class="product-photo"><img src="${e(displayImage(p.image_url,p.category,p.subcategory))}" alt="${e(p.title)}${real?' 상품 이미지':' 분류 대표 이미지'}" width="960" height="720" loading="lazy">${real?'':'<small>분류 대표 이미지 · AI 생성</small>'}</span>`}
function imageFields(value=''){return `<label class="wide">대표 이미지 선택<select name="imageUrl"><option value="">분류 대표 이미지 자동 사용</option>${value&&!generatedImage(value)?`<option value="${e(value)}" selected>현재 업로드 사진</option>`:''}${imageCategories.map(id=>`<option value="${categoryImage(id)}"${value===categoryImage(id)?' selected':''}>${e(categoryNames[id])} · AI 대표 이미지</option>`).join('')}${leafEntries.map(x=>`<option value="${x.src}"${value===x.src?' selected':''}>${e(categoryNames[x.category])} › ${e(x.name)} · AI 품목 이미지</option>`).join('')}</select></label><label class="wide">직접 사진 업로드·교체 (JPG/PNG/WebP · 2MB 이하)<input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp"></label><label class="check wide"><input name="imagePermission" type="checkbox">직접 업로드할 사진의 공개 사용 권한을 확인했습니다. 사진은 업체·상품 공개 상태에 따라 노출됩니다.</label>`}
async function formImage(form,storeId){const file=form.elements.imageFile?.files?.[0];if(!file)return form.elements.imageUrl.value;if(!form.elements.imagePermission.checked)throw Error('업로드 사진의 공개 사용 권한을 확인해 주세요.');if(file.size>2097152)throw Error('2MB 이하 사진을 선택하세요.');const body=new FormData();body.append('file',file);body.append('storeId',storeId);body.append('publishConsent','true');const r=await fetch('/market-media',{method:'POST',body,credentials:'same-origin'});if(!r.ok){let error=await r.text();try{error=JSON.parse(error).error}catch{}throw Error(error||'사진 업로드 실패')}return (await r.json()).url}
function profileForm(s){return `<details class="operations-panel"><summary>${e(s.name)} · 업체정보·대표사진 수정</summary><form class="store-profile-form form-grid" data-id="${s.id}" data-version="${s.version}"><label>업체명<input name="name" maxlength="60" value="${e(s.name)}" required></label><label>공개 연락처<input name="phone" maxlength="40" value="${e(s.phone)}"></label><label class="wide">업체 주소<input name="address" maxlength="200" value="${e(s.address)}" required></label><label class="wide">업체 소개<textarea name="description" maxlength="2000">${e(s.description)}</textarea></label><label>배송비<input name="deliveryFee" type="number" min="0" max="1000000" value="${s.delivery_fee}" required></label><label>최소 주문액<input name="minimumOrder" type="number" min="0" max="100000000" value="${s.minimum_order}" required></label>${imageFields(s.image_url)}<button class="primary">업체정보·사진 저장</button></form></details>`}
function productCard(p) {
  return `<article class="product-card"><button class="product-detail-trigger" data-detail="${e(p.id)}" aria-label="${e(p.title)} 상세 보기">${productImage(p)}<span class="product-category">${e(p.storeName)}</span><h3>${e(p.title)}</h3><p>${e(p.unit)} · ${e(p.origin)}</p><strong>${won(p.price)}</strong></button><small>${p.stock > 0 ? "판매가능 " + p.stock + "개" : "품절"}</small><button data-add="${e(p.id)}"${p.stock ? "" : " disabled"}>${p.stock ? "담기 +" : "품절"}</button></article>`;
}
function productDialog() {
  const preview = leafEntries.find(x => state.detail === 'preview:' + x.category + '/' + x.id);
  const p = preview ? {title:preview.title,category:preview.category,subcategory:preview.id,unit:preview.unit,image_url:preview.src} : state.catalog.find(p => p.id === state.detail);
  if (!p) return "";
  return `<dialog id="productDetail" aria-labelledby="detailTitle" class="market-product-sheet"><div class="detail-toolbar"><span>ARIRANG MARKET</span><button class="detail-close" data-close-detail aria-label="상품 상세 닫기">✕</button></div><p class="detail-path">${e(departmentFor(p.category)?.name)} › ${e(categoryNames[p.category])}${p.subcategory ? " › " + e(leafName(p.category, p.subcategory)) : ""}</p><div class="detail-hero">${productImage(p)}</div><div class="detail-summary"><span class="detail-kicker">${preview ? 'AI 상품 이미지 예시' : e(p.storeName)}</span><h2 id="detailTitle">${e(p.title)}</h2><p>${e(p.unit)}${preview ? ' · 판매 준비 중' : ' · '+e(p.origin)}</p>${preview ? '<p class="detail-preview-note">판매 형태를 보여주는 생성 이미지입니다. 실제 상품·가격·구성은 입점업체 등록 후 확인할 수 있습니다.</p>' : `<strong class="detail-price">${won(p.price)}</strong><span class="detail-stock">${p.stock > 0 ? '판매가능 '+e(p.stock)+'개' : '품절'}</span>`}</div><nav class="detail-tabs" aria-label="상품 상세 안내"><button data-detail-section="detailOverview">상품정보</button><button data-detail-section="detailDelivery">배송안내</button><button data-detail-section="detailNotice">구매안내</button></nav><section id="detailOverview" class="detail-section"><p class="detail-kicker">PRODUCT INFORMATION</p><h3>상품을 자세히 살펴보세요.</h3><dl><dt>상품명</dt><dd>${e(p.title)}</dd><dt>판매 단위</dt><dd>${e(p.unit)}</dd><dt>원산지</dt><dd>${preview ? '판매상품 등록 후 표시' : e(p.origin)}</dd><dt>보관</dt><dd>${preview ? '실제 상품 표시사항 확인' : e({ambient:'실온',chilled:'냉장',frozen:'냉동'}[p.storage] || '업체 확인')}</dd></dl><p class="detail-description">${e(preview ? '이 이미지는 소분류에 맞는 포장 형태를 안내하는 예시입니다.' : p.description || '등록된 상세 설명이 없습니다.')}</p></section><section id="detailDelivery" class="detail-section"><p class="detail-kicker">LOCAL DELIVERY</p><h3>우리 동네에서 만나는 장보기</h3><p>등록한 배송주소와 해당 지역 입점업체를 기준으로 상품을 확인합니다.</p><p>카드결제·외부 배달대행 연결 준비 중입니다. 현재 실제 주문 접수 전입니다.</p></section><section id="detailNotice" class="detail-section"><p class="detail-kicker">BEFORE YOU ORDER</p><h3>구매 전 확인해 주세요.</h3><p>${preview ? '판매 준비 중인 이미지 예시로, 주문하거나 결제할 수 없습니다.' : '상품 구성·원산지·보관 방법과 판매자 정보를 확인해 주세요. AI 대표 이미지는 실제 상품의 외관·포장·수량과 다를 수 있습니다.'}</p></section><div class="detail-actions"><button data-close-detail>← 목록으로</button><a href="#shop" data-detail-home>마켓 홈</a>${preview ? '<button class="primary" disabled>판매 준비 중</button>' : `<button class="primary" data-add="${e(p.id)}"${p.stock ? '' : ' disabled'}>장바구니 담기</button>`}</div></dialog>`;
}
function shop() {
  const focused = !!(
      state.search ||
      state.major !== "all" ||
      state.category !== "all" ||
      state.leaf ||
      state.filterStore
    ),
    rows = results();
  return `
 <section class="delivery-strip" aria-label="배송 지역"><a class="delivery-address-link" href="#addresses">${selectedDelivery() ? e(selectedDelivery().label) + " · " + e(selectedDelivery().address_base) : state.member ? "배송지 등록·선택" : "로그인하고 배송지 등록"} <span>변경 ›</span></a><label>배송 지역 <select id="regionSelect" aria-label="판매·배송 지역">${regionOptions(state.region?.id)}</select></label><button id="locate">내 위치</button><button id="autoRegion" aria-label="접속 지역 다시 확인">자동 연결</button></section>
 ${!focused ? `<section class="market-intro"><img class="market-hero-image" src="${categoryImage('meat')}" alt="" width="960" height="720"><div class="market-hero-copy"><p class="eyebrow">ARIRANG MARKET · LOCAL SELECTION</p><h1>좋은 먹거리,<br>가까운 곳에서.</h1><p>${state.region ? e(state.region.name) + " 지역 업체의 상품을 만나보세요." : "신선식품부터 생활용품까지, 우리 동네 장보기."}</p><button class="hero-explore" data-browse-major="fresh">신선식품 둘러보기 <span aria-hidden="true">→</span></button></div></section><section class="specialty-halls" aria-label="전문관">${departments.map((d) => `<button data-browse-major="${d.id}" class="hall-card" data-category-color="${d.id}"><img src="${categoryImage(d.categories[0])}" alt="" width="960" height="720" loading="lazy"><strong>${d.name}</strong><small>${d.note}</small></button>`).join("")}</section>` : ""}
 ${categoryBrowser(!focused)}
 <section class="catalog-section" aria-labelledby="catalogTitle"><div class="catalog-heading"><div><p class="browse-crumb">${e(state.major === "all" ? "전체 상품" : departments.find((d) => d.id === state.major)?.name)}${state.category !== "all" ? " › " + e(categoryNames[state.category]) : ""}${state.leaf ? " › " + e(leafName(state.category, state.leaf)) : ""}</p><h2 id="catalogTitle" tabindex="-1">${state.search ? "“" + e(state.search) + "” 검색 결과" : "우리 지역 상품"} <small>${rows.length}</small></h2></div><select id="productSort" aria-label="상품 정렬">${[
   ["recommended", "기본순"],
   ["price-asc", "낮은 가격순"],
   ["price-desc", "높은 가격순"],
   ["name", "상품명순"],
 ]
   .map(
     ([id, name]) =>
       `<option value="${id}"${state.sort === id ? " selected" : ""}>${name}</option>`,
   )
   .join("")}</select></div>
 ${state.region&&state.stores.length&&!focused?`<section class="store-showcase" aria-label="입점업체 소개">${state.stores.map(s=>`<article><img src="${e(displayImage(s.imageUrl,'fruit'))}" alt="${e(s.name)} 대표 이미지" width="960" height="720" loading="lazy"><div><h3>${e(s.name)}</h3><p>${e(s.description||s.address)}</p>${s.phone?`<p>연락처 ${e(s.phone)}</p>`:""}${!s.imageUrl||generatedImage(s.imageUrl)?'<small>분류 대표 이미지 · AI 생성</small>':""}</div></article>`).join('')}</section>`:""}${state.region ? `<label class="store-filter">입점업체 <select id="storeFilter" aria-label="입점업체 필터"><option value="">전체 업체 (${state.stores.length})</option>${state.stores.map((v) => `<option value="${v.id}"${state.filterStore && state.store?.id === v.id ? " selected" : ""}>${e(v.name)}</option>`).join("")}</select></label>` : ""}
 <div class="product-grid">${rows.map(productCard).join("") || `<div class="catalog-empty"><h3>${!state.region ? "배송 지역을 먼저 선택해 주세요." : state.catalog.length ? "조건에 맞는 상품이 없습니다." : "이 지역의 판매 상품을 준비하고 있습니다."}</h3><p>${state.catalog.length ? "검색어를 줄이거나 분류를 넓혀보세요." : "실제 입점업체가 공개한 상품만 표시합니다."}</p>${focused ? "<button data-clear-browse>검색·분류 초기화</button>" : ""}</div>`}</div>${!rows.length?leafPreviewGallery():""}</section>${productDialog()}`;
}
function orderCard(o, workspace) {
  const isStaff = workspace === "staff",
    role = state.staff?.role,
    status = statuses[o.status],
    actions = [];
  const actionButton = (action, label) =>
    `<button data-order-action="${action}" data-order-id="${o.id}" data-version="${o.version}">${label}</button>`;
  if (!isStaff && o.status === "new")
    actions.push(actionButton("cancel", "접수 전 취소"));
  if (isStaff && ["merchant", "operator"].includes(role)) {
    const next = {
      new: ["accept", "주문 접수"],
      accepted: ["prepare", "상품 준비 시작"],
      preparing: ["ready", "픽업 준비 완료"],
    }[o.status];
    if (next) actions.push(actionButton(...next));
    if (o.status === "new") actions.push(actionButton("reject", "주문 거절"));
    if (!["picked_up", "delivered", "cancelled", "rejected"].includes(o.status))
      actions.push(actionButton("cancel", "사유 기록 후 취소"));
  }
  if (isStaff && role === "rider") {
    if (o.status === "ready" && !o.riderId)
      actions.push(actionButton("claim", "이 배송 수락"));
    if (o.riderId === state.staff.id && o.status === "ready")
      actions.push(actionButton("pickup", "픽업 확인"));
    if (o.riderId === state.staff.id && o.status === "picked_up")
      actions.push(
        `<label>고객 인계 확인번호<input data-code-for="${o.id}" inputmode="numeric" maxlength="4" autocomplete="off"></label>`,
        actionButton("deliver", "인계 확인·배송 완료"),
      );
    if (
      o.riderId === state.staff.id &&
      !["delivered", "cancelled", "rejected"].includes(o.status)
    )
      actions.push(actionButton("incident", "배송 문제 기록"));
  }
  if (
    isStaff &&
    role === "operator" &&
    ["ready", "picked_up"].includes(o.status)
  )
    actions.push(
      `<label>배정할 라이더<select data-rider-for="${o.id}">${options((state.ops?.accounts || []).filter((a) => a.role === "rider" && a.active && a.on_duty))}</select></label>`,
      actionButton(
        o.riderId ? "reassign" : "assign",
        o.riderId ? "사유 기록 후 재배차" : "운영자 배차",
      ),
    );
  if (isStaff && role === "operator" && o.status === "picked_up")
    actions.push(
      actionButton("reset_delivery_attempts", "인계번호 시도 한도 초기화"),
    );
  return `<article class="order-card"><div class="section-title"><h2>${e(status)}${o.status === "ready" && o.riderId ? " · 라이더 배정" : ""}</h2><small>${e(o.id.slice(0, 8))} · ${new Date(o.createdAt).toLocaleString("ko-KR")}</small></div><ol class="order-progress">${["new", "accepted", "preparing", "ready", "picked_up", "delivered"].map((s) => `<li${s === o.status ? ' aria-current="step"' : ""}>${statuses[s]}</li>`).join("")}</ol><ul>${o.items.map((p) => `<li>${e(p.title)} ${p.quantity}개 · ${won(p.price * p.quantity)}</li>`).join("")}</ul><p><strong>합계 ${won(o.total)}</strong> · 배송비 ${won(o.deliveryFee)} 포함</p><p class="payment-note">현장결제 / 결제 확인 안 됨 · 배송 완료와 별개</p>${o.addressBase ? `<p>${e(o.customerName)} · <a href="tel:${e(o.phone)}">${e(o.phone)}</a></p><p>${e(o.addressBase)} ${e(o.addressDetail)}</p>` : '<p class="muted">고객 연락처·배송 상세주소는 배차 수락 후 공개됩니다.</p>'}${o.deliveryCode && o.status !== "delivered" ? `<p class="delivery-code">인계 확인번호 <strong>${e(o.deliveryCode)}</strong><small>물품을 받은 뒤 배정 라이더에게 알려주세요.</small></p>` : ""}<div class="order-actions">${actions.join("")}</div></article>`;
}
function customerOrders() {
  if (!state.member)
    return `<section class="member-panel"><h1>회원 주문 내역</h1><p>로그인하면 등록한 계정의 주문을 확인할 수 있습니다.</p><a class="primary-link" href="#member">로그인·회원가입</a></section>`;
  return `<div class="section-title"><div><p class="eyebrow">MY ORDERS</p><h1>내 주문 내역</h1></div><button id="refreshOrders">새로고침</button></div><p class="muted">주문 내역은 로그인한 회원 계정으로 조회합니다. 접수 대기 15분 초과 주문은 자동 정리 시 취소·재고 반환되며, 만료 후 접수는 차단됩니다.</p>${state.orders.length ? state.orders.map((o) => orderCard(o, "customer")).join("") : '<div class="empty"><h2>확인할 주문이 없습니다.</h2><a href="#shop">내 지역 장보기 →</a></div>'}`;
}
function login() {
  return `<section class="login-panel"><p class="eyebrow">PARTNER WORKSPACE</p><h1>입점업체·운영자 접속</h1><p>운영자가 발급한 계정으로 접속하세요. 구매자는 별도 파트너 로그인이 필요하지 않습니다.</p><form id="staffLogin"><label>접속 유형<select name="role"><option value="staff">입점업체 발급 계정</option><option value="operator">플랫폼 운영자</option></select></label><label id="partnerUsername">계정<input name="username" maxlength="60" required autocomplete="username"></label><label>비밀번호<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="current-password"></label><button class="primary">접속</button></form><p class="muted">입점업체는 발급받은 계정으로 접속하세요. 운영자는 접속 유형에서 플랫폼 운영자를 선택합니다.</p></section>`;
}
function staffWorkspace() {
  if (!state.staff) return login();
  const role = state.staff.role;
  return `<div class="section-title"><div><p class="eyebrow">${e(role.toUpperCase())} WORKSPACE</p><h1>${{ merchant: "판매자 주문 접수", rider: "라이더 배송", operator: "운영자 주문·배차" }[role]}</h1></div><div><button id="refreshOrders">새로고침</button><button id="staffLogout">로그아웃</button></div></div>${["merchant","operator"].includes(role)?'<p><a class="button" href="partner-finance.html">계약·전자서명 · 정산·지급요청 업무실 →</a></p>':""}${role === "rider" ? `<label class="check duty"><input id="riderDuty" type="checkbox"${state.staff.onDuty ? " checked" : ""}> 현재 근무 중 · 지정 지역 배송 요청 받기</label><p class="muted">기본 단건 배차입니다. 배송 수락 → 픽업 확인 → 고객 인계번호 확인 순서로 처리합니다.</p>` : '<p class="muted">접수 → 상품 준비 → 픽업 준비 완료 순서로 처리합니다. 배송 완료는 배정된 라이더가 인계 확인 후 처리합니다.</p>'}${role === "merchant" ? `${state.ops?.stores.map(profileForm).join('')||''}<label class="check duty"><input id="merchantOpen" type="checkbox"${state.ops?.stores[0]?.open ? " checked" : ""}${state.ops?.stores[0]?.status === "active" ? "" : " disabled"}> 현재 주문 받기</label><details class="operations-panel"><summary>내 업체 상품 등록 · 최대 50개</summary>${productForm()}<div id="managedProducts"></div></details>` : ""}${state.orders.length ? state.orders.map((o) => orderCard(o, "staff")).join("") : '<div class="empty"><h2>현재 처리할 주문이 없습니다.</h2><p>접수된 주문과 지정 지역의 배송 요청이 이곳에 표시됩니다.</p></div>'}`;
}
function productForm() {
  return `<form id="productForm" class="form-grid">${state.staff.role === "operator" ? `<label>입점업체<select name="storeId" required>${options(state.ops.stores)}</select></label>` : ""}<label>상품명<input name="title" maxlength="80" required></label><label>대분류<select name="major">${departments.map((d) => `<option value="${d.id}">${d.name}</option>`).join("")}</select></label><label>중분류<select name="category">${Object.entries(
    categoryNames,
  )
    .map(([id, name]) => `<option value="${id}">${name}</option>`)
    .join(
      "",
    )}</select></label><label>소분류<select name="subcategory" required></select></label><label>구성·중량<input name="unit" maxlength="40" required></label><label>판매가 (원)<input name="price" type="number" min="1" max="100000000" step="1" required></label><label>판매가능 수량<input name="stock" type="number" min="0" max="100000" step="1" required></label><label>원산지·표시 정보<input name="origin" maxlength="200" required></label><label>보관 방식<select name="storage"><option value="ambient">실온</option><option value="chilled">냉장</option><option value="frozen">냉동</option></select></label><label class="wide">상품 설명<textarea name="description" maxlength="2000"></textarea></label>${imageFields()}<label class="check"><input type="checkbox" name="active"> 상품 공개</label><button class="primary">상품 등록</button></form>`;
}
function operations() {
  if (!state.staff) return login();
  if (state.staff.role !== "operator")
    return '<div class="empty"><h1>운영자 권한이 필요합니다.</h1><a href="#staff">내 업무 화면으로 →</a></div>';
  const data = state.ops;
  if (!data) return "<p>운영 정보를 불러오고 있습니다.</p>";
  return `<div class="section-title"><div><p class="eyebrow">MULTI-REGION OPERATIONS</p><h1>지역·입점업체·라이더 관리</h1></div><button id="staffLogout">로그아웃</button></div><p class="capacity">전체 입점 정원 ${data.vendorCount} / 100개 · 업체별 상품 최대 50개</p><section class="operations-panel"><p><a class="button" href="partner-finance.html">계약·전자서명 · 정산·지급요청 업무실 →</a></p><h2>1. 판매·배송 지역 등록</h2><p class="muted">소도시는 시 전체, 대도시는 구 또는 동으로 나눕니다. 자동 연결용 영문 도시명은 IP 도시 별칭에 입력하세요.</p><form id="regionForm" class="form-grid"><label>표시 이름<input name="name" maxlength="60" required placeholder="예: 대전 동구 홍도동"></label><label>도시 구분<select name="cityType"><option value="small">소도시</option><option value="large">대도시</option></select></label><label>시·도<input name="province" required placeholder="예: 충남 / 대전 / 서울"></label><label>시 이름<input name="city" required placeholder="예: 공주시 / 대전 / 서울"></label><label>권역 단위<select name="level"><option value="city">시 단위</option><option value="district">구 단위</option><option value="dong">동 단위</option></select></label><label>구 이름<input name="district" placeholder="대도시만 입력"></label><label>동 이름<input name="dong" placeholder="동 단위일 때 입력"></label><label>IP 도시 별칭<input name="aliases" placeholder="예: daejeon (쉼표 구분)"></label><label class="check"><input name="active" type="checkbox"> 지역 운영 활성화</label><button class="primary">지역 등록</button></form><ul class="data-list">${data.regions.map((r) => `<li><strong>${e(r.name)}</strong><span>${e(r.level)} · ${r.active ? "활성" : "비활성"}</span><button data-region-toggle="${r.id}" data-active="${!r.active}">${r.active ? "운영 중지" : "운영 시작"}</button></li>`).join("") || "<li>등록된 지역 없음</li>"}</ul></section><section class="operations-panel"><h2>2. 입점업체와 배송 구역</h2><form id="storeForm" class="form-grid"><label>업체명<input name="name" maxlength="60" required></label><label>업체 소재 지역<select name="regionId" required>${options(data.regions)}</select></label><label class="wide">업체 주소<input name="address" maxlength="200" required></label><label>배송비 (원)<input name="deliveryFee" type="number" min="0" max="1000000" step="1" required></label><label>최소 주문 상품금액<input name="minimumOrder" type="number" min="0" max="100000000" step="1" required></label><label class="wide">배송 가능 지역 (여러 개 선택)<select name="serviceRegions" multiple size="4">${data.regions.map((r) => `<option value="${r.id}">${e(r.name)}</option>`).join("")}</select></label><button class="primary">업체 심사 대기로 등록</button></form><div class="data-list">${data.stores.map((s) => `<form class="store-status-form" data-id="${s.id}"><strong>${e(s.name)}</strong><select name="status">${["pending", "active", "suspended", "rejected"].map((v) => `<option value="${v}"${s.status === v ? " selected" : ""}>${{ pending: "심사 대기", active: "승인", suspended: "일시 중단", rejected: "반려" }[v]}</option>`).join("")}</select><label class="check"><input type="checkbox" name="open"${s.open ? " checked" : ""}> 주문 받기</label><button>상태 저장</button></form>`).join("")}</div></section><section class="operations-panel">${data.stores.map(profileForm).join('')}<h2>3. 판매자·라이더 계정 발급</h2><form id="accountForm" class="form-grid"><label>역할<select name="role"><option value="merchant">판매자</option><option value="rider">라이더</option></select></label><label>계정명<input name="username" maxlength="60" required autocomplete="off"></label><label>표시 이름<input name="name" maxlength="40" required></label><label>판매자 소속 업체<select name="storeId">${options(data.stores)}</select></label><label class="wide">라이더 활동 지역 (여러 개 선택)<select name="regionIds" multiple size="4">${data.regions.map((r) => `<option value="${r.id}">${e(r.name)}</option>`).join("")}</select></label><button class="primary">계정·비밀번호 발급</button></form>${state.credential ? `<div class="credential"><strong>발급 결과 · 이 화면에서만 확인</strong><p>계정 ${e(state.credential.username)}</p><code>${e(state.credential.password)}</code><button id="hideCredential">발급 결과 숨기기</button></div>` : ""}<ul class="data-list">${data.accounts.map((a) => `<li><strong>${e(a.name)}</strong><span>${e(a.username)} · ${e(a.role)} · ${a.active ? (a.on_duty ? "근무 중" : "대기") : "비활성"}</span><button data-account-toggle="${a.id}" data-active="${!a.active}">${a.active ? "접속 중지" : "접속 허용"}</button><button data-password-reset="${a.id}">비밀번호 재발급</button></li>`).join("")}</ul></section><section class="operations-panel"><h2>4. 업체 상품 등록·편집</h2>${productForm()}<label>편집할 업체<select id="manageStore">${options(data.stores)}</select></label><div id="managedProducts"></div></section><p><a href="#staff">주문·배차 관리로 이동 →</a></p>`;
}
async function loadView() {
  if (!state.connected) return;
  const v = view();
  if (
    ["member", "addresses", "orders"].includes(v) &&
    window.ARIRANG_MEMBER_AUTH
  )
    await refreshMember();
  if (v === "orders") {
    if (!state.member) {
      render();
      return;
    }
    await customerSession();
    state.orders = await api("/orders");
  }
  if (["staff", "operations"].includes(v)) {
    const session = await api("/session");
    state.staff = session.staff;
    if (state.staff) {
      state.ops = await api("/operations");
      state.orders = v === "staff" ? await api("/orders?workspace=staff") : [];
    }
  }
  render();
}
function render() {
  document.body.dataset.brand=["staff","operations"].includes(view())?"coral":"green";
  document.body.dataset.areaName=document.body.dataset.brand==="coral"?"입점업체·파트너":"소비자·장보기";
  document.querySelectorAll('[data-brand-label]').forEach(label=>label.textContent=document.body.dataset.areaName);

  const searchInput = document.querySelector("#marketSearch [name=q]");
  if (searchInput && document.activeElement !== searchInput)
    searchInput.value = state.search;
  document
    .querySelectorAll("[data-customer-view]")
    .forEach((a) =>
      a.setAttribute(
        "aria-current",
        a.dataset.customerView === view() ? "page" : "false",
      ),
    );
  const badge = document.querySelector("#basketCount");
  if (badge)
    badge.textContent =
      Object.values(state.basket).reduce((a, b) => a + b, 0) || "";

  document
    .querySelectorAll(".local-tabs [data-view]")
    .forEach((a) =>
      a.setAttribute(
        "aria-current",
        a.dataset.view === view() ? "page" : "false",
      ),
    );
  const memberLink = document.querySelector("#memberNavLink");
  if (memberLink)
    memberLink.textContent = state.member ? "마이페이지" : "로그인·가입";
  const banner = document.getElementById("serviceState");
  banner.textContent = state.connected
    ? state.config.liveOrders
      ? "지역별 장보기 · 카드결제·외부 배달대행 연결 준비 중"
      : "카드결제·외부 배달대행 연결 준비 중 · 실제 주문 접수 전입니다."
    : "주문 서비스 저장소 연결 준비 중입니다. 운영 안내 페이지를 이용해 주세요.";
  root.innerHTML = !state.connected
    ? '<div class="empty"><h1>지역 주문 서비스를 준비하고 있습니다.</h1><p>저장소 연결과 운영 설정이 완료되면 지역별 업체와 주문·배송 화면이 열립니다.</p><a href="/arirang-market.html">아리랑마켓 안내로 →</a><button id="retryConnection">연결 다시 확인</button></div>'
    : view() === "member"
      ? memberView()
      : view() === "addresses"
        ? addressesView()
        : view() === "cart"
          ? state.store
            ? basketView()
            : '<div class="empty"><h1>장바구니</h1><p>상품 목록에서 원하는 상품을 담아주세요.</p><a href="#shop">장보기 →</a></div>'
          : view() === "categories"
            ? `<h1 class="browse-title">카테고리</h1>${categoryBrowser()}<p><a href="#shop" data-show-results>선택한 분류의 상품 보기 →</a></p>`
            : view() === "shop"
              ? shop()
              : view() === "orders"
                ? customerOrders()
                : view() === "staff"
                  ? staffWorkspace()
                  : operations();
  bind();
}
function run(task) {
  return async (event) => {
    event?.preventDefault();
    try {
      const notice = await task(event);
      message(typeof notice === "string" ? notice : "처리했습니다.");
    } catch (error) {
      message(error.message, true);
    }
  };
}
function bind() {
  bindMember();
  root.querySelector("[data-show-results]")?.addEventListener("click", (event) => {
    event.preventDefault();
    setBrowse({}, true);
  });
  root.querySelectorAll('[data-preview-category]').forEach(b=>b.onclick=()=>{setBrowse({category:b.dataset.previewCategory,leaf:b.dataset.previewLeaf},true);state.detail='preview:'+b.dataset.previewCategory+'/'+b.dataset.previewLeaf;render();});
  root.querySelectorAll("[data-browse-major]").forEach(
    (b) =>
      (b.onclick = () =>
        setBrowse({
          major: b.dataset.browseMajor,
          category: "all",
          leaf: "",
        })),
  );
  root
    .querySelectorAll("[data-browse-category]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          setBrowse({ category: b.dataset.browseCategory, leaf: "" })),
    );
  root
    .querySelectorAll("[data-browse-leaf]")
    .forEach(
      (b) => (b.onclick = () => setBrowse({ leaf: b.dataset.browseLeaf }, true)),
    );
  root.querySelector("[data-clear-browse]")?.addEventListener("click", () => {
    state.filterStore = false;
    setBrowse({ major: "all", category: "all", leaf: "", search: "" });
  });
  root
    .querySelector("#productSort")
    ?.addEventListener("change", (ev) => setBrowse({ sort: ev.target.value }));
  root.querySelector("#storeFilter")?.addEventListener(
    "change",
    run(async (ev) => {
      if (!ev.target.value) {
        state.filterStore = false;
        render();
        return;
      }
      await chooseStore(ev.target.value);
    }),
  );
  root.querySelectorAll("[data-detail]").forEach(
    (b) =>
      (b.onclick = () => {
        state.detail = b.dataset.detail;
        render();
      }),
  );
  root.querySelectorAll("[data-close-detail]").forEach(
    (b) =>
      (b.onclick = () => {
        state.detail = null;
        render();
      }),
  );
  root.querySelector("[data-detail-home]")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    state.detail = null;
    setBrowse({ major: "all", category: "all", leaf: "", search: "" });
  });
  root.querySelectorAll("[data-detail-section]").forEach(b=>b.onclick=()=>root.querySelector("#"+b.dataset.detailSection)?.scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"}));
  const dialog = root.querySelector("#productDetail");
  if (dialog) {
    dialog.showModal();
    dialog.addEventListener("cancel", () => {
      state.detail = null;
    });
    dialog.addEventListener("click", (ev) => {
      if (ev.target === dialog) {
        state.detail = null;
        render();
      }
    });
  }
  const pf = root.querySelector("#productForm");
  if (pf) {
    const middle = pf.elements.category,
      major = pf.elements.major,
      leaf = pf.elements.subcategory;
    const fillLeaf = () => {
      leaf.innerHTML =
        '<option value="">소분류 선택</option>' +
        leaves[middle.value]
          .map(([id, name]) => `<option value="${id}">${name}</option>`)
          .join("");
    };
    const fillMiddle = () => {
      middle.innerHTML = departments
        .find((d) => d.id === major.value)
        .categories.map(
          (id) => `<option value="${id}">${categoryNames[id]}</option>`,
        )
        .join("");
      fillLeaf();
    };
    major.onchange = fillMiddle;
    middle.onchange = fillLeaf;
    fillMiddle();
  }
  const roleSelect = root.querySelector("#staffLogin [name=role]");
  if (roleSelect)
    roleSelect.onchange = () => {
      const label = root.querySelector("#partnerUsername"),
        field = label.querySelector("input");
      label.hidden = roleSelect.value === "operator";
      field.required = !label.hidden;
      field.disabled = label.hidden;
    };
  root
    .querySelector("#retryConnection")
    ?.addEventListener("click", () => initialize());
  root.querySelector("#regionSelect")?.addEventListener(
    "change",
    run((e) => chooseRegion(e.target.value)),
  );
  root.querySelector("#locate")?.addEventListener(
    "click",
    run(() => locate(true)),
  );
  root.querySelector("#autoRegion")?.addEventListener(
    "click",
    run(async () => {
      try {
        localStorage.removeItem("arirang-delivery-region");
      } catch {}
      await locate(false);
    }),
  );
  root
    .querySelectorAll("[data-store]")
    .forEach((b) => (b.onclick = run(() => chooseStore(b.dataset.store))));
  const changeQuantity = (id, delta) => {
    const p = state.products.find((p) => p.id === id),
      n = (state.basket[id] || 0) + delta;
    if (!p || n > Math.min(p.stock, 100))
      return message("판매가능 수량을 확인하세요.", true);
    if (n <= 0) delete state.basket[id];
    else state.basket[id] = n;
    resetCheckout();
    saveBasket();
    render();
  };
  root.querySelectorAll("[data-add]").forEach(
    (b) =>
      (b.onclick = run(async () => {
        const p = state.catalog.find((p) => p.id === b.dataset.add);
        if (!p) return;
        const wasFiltered = state.filterStore;
        state.detail = null;
        if (state.store?.id !== p.store_id) {
          await chooseStore(p.store_id);
          if (state.store?.id !== p.store_id) return;
        }
        state.filterStore = wasFiltered;
        changeQuantity(p.id, 1);
        message(p.title + "을 장바구니에 담았습니다.");
      })),
  );
  root
    .querySelectorAll("[data-qty]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          changeQuantity(b.dataset.qty, Number(b.dataset.delta))),
    );
  const form = root.querySelector("#checkoutForm");
  if (form) {
    form.elements.addressBase.oninput = () => {
      state.address = null;
      state.checkoutKey = null;
      root.querySelector("#addressResult").textContent =
        "주소를 다시 확인해 주세요.";
    };
    root.querySelector("#checkAddress").onclick = run(async () => {
      if (!form.elements.addressBase.value.trim())
        throw Error("도로명 또는 지번 주소를 입력하세요.");
      if (!form.elements.consent.checked)
        throw Error("주소 확인 전에 주문·배송 정보 이용 안내에 동의해 주세요.");
      await customerSession();
      state.address = await post("/address-check", {
        storeId: state.store.id,
        regionId: state.region.id,
        consent: true,
        addressBase: form.elements.addressBase.value.trim(),
      });
      root.querySelector("#addressResult").textContent =
        "배송 지역 확인 완료: " + state.address.addressBase;
    });
    form.onsubmit = run(async () => {
      if (!form.reportValidity()) return;
      if (!state.address) throw Error("배송 지역·주소 확인을 먼저 진행하세요.");
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      try {
        await customerSession();
        state.checkoutKey ||= uid();
        await post("/orders", {
          storeId: state.store.id,
          regionId: state.region.id,
          addressCheckId: state.address.id,
          idempotencyKey: state.checkoutKey,
          expectedTotal:
            basketItems().reduce((a, p) => a + p.price * p.quantity, 0) +
            state.store.deliveryFee,
          items: basketItems().map((p) => ({
            productId: p.id,
            quantity: p.quantity,
          })),
          customerName: form.elements.customerName.value,
          phone: form.elements.phone.value,
          addressDetail: form.elements.addressDetail.value,
          consent: form.elements.consent.checked,
        });
        state.basket = {};
        saveBasket();
        resetCheckout();
        location.hash = "#orders";
      } finally {
        button.disabled = false;
      }
    });
  }
  root.querySelector("#staffLogin")?.addEventListener(
    "submit",
    run(async (event) => {
      const v = Object.fromEntries(new FormData(event.target));
      state.staff = (await post("/login", v)).actor;
      event.target.reset();
      await loadView();
    }),
  );
  root.querySelector("#staffLogout")?.addEventListener(
    "click",
    run(async () => {
      await post("/logout", {});
      state.staff = null;
      state.credential = null;
      render();
    }),
  );
  root
    .querySelector("#refreshOrders")
    ?.addEventListener("click", run(loadView));
  root.querySelector("#merchantOpen")?.addEventListener(
    "change",
    run(async (event) => {
      await post("/availability", { open: event.target.checked });
      await loadView();
    }),
  );
  root.querySelector("#riderDuty")?.addEventListener(
    "change",
    run(async (event) => {
      await post("/duty", { onDuty: event.target.checked });
      await loadView();
    }),
  );
  root.querySelectorAll("[data-order-action]").forEach(
    (button) =>
      (button.onclick = run(async () => {
        const action = button.dataset.orderAction,
          data = {
            action,
            version: Number(button.dataset.version),
            workspace: view() === "staff" ? "staff" : "customer",
          };
        if (
          [
            "cancel",
            "reject",
            "incident",
            "reset_delivery_attempts",
            "reassign",
          ].includes(action)
        ) {
          data.note = prompt("처리 사유 또는 배송 문제를 입력하세요.");
          if (!data.note) return;
        }
        if (action === "deliver")
          data.deliveryCode = root.querySelector(
            `[data-code-for="${button.dataset.orderId}"]`,
          ).value;
        if (["assign", "reassign"].includes(action))
          data.riderId = root.querySelector(
            `[data-rider-for="${button.dataset.orderId}"]`,
          ).value;
        button.disabled = true;
        try {
          await post("/orders/" + button.dataset.orderId + "/action", data);
          await loadView();
        } catch (error) {
          await loadView();
          throw error;
        }
      })),
  );
  root.querySelectorAll("[data-region-toggle]").forEach(
    (b) =>
      (b.onclick = run(async () => {
        await api("/regions/" + b.dataset.regionToggle, {
          method: "PATCH",
          body: JSON.stringify({ active: b.dataset.active === "true" }),
        });
        await refreshOperations();
      })),
  );
  root.querySelectorAll("[data-account-toggle]").forEach(
    (b) =>
      (b.onclick = run(async () => {
        await api("/accounts/" + b.dataset.accountToggle, {
          method: "PATCH",
          body: JSON.stringify({ active: b.dataset.active === "true" }),
        });
        await refreshOperations();
      })),
  );
  root.querySelectorAll("[data-password-reset]").forEach(
    (b) =>
      (b.onclick = run(async () => {
        if (!confirm("기존 비밀번호와 접속 세션을 폐기하고 재발급할까요?"))
          return;
        state.credential = await api("/accounts/" + b.dataset.passwordReset, {
          method: "PATCH",
          body: JSON.stringify({ resetPassword: true }),
        });
        await refreshOperations();
      })),
  );
  root.querySelector("#regionForm")?.addEventListener(
    "submit",
    run(async (event) => {
      const form = event.target,
        v = Object.fromEntries(new FormData(form));
      v.active = form.elements.active.checked;
      v.aliases = v.aliases
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await post("/regions", v);
      await refreshOperations();
    }),
  );
  root.querySelector("#storeForm")?.addEventListener(
    "submit",
    run(async (event) => {
      const v = Object.fromEntries(new FormData(event.target));
      v.serviceRegions = new FormData(event.target).getAll("serviceRegions");
      v.deliveryFee = Number(v.deliveryFee);
      v.minimumOrder = Number(v.minimumOrder);
      await post("/stores", v);
      await refreshOperations();
    }),
  );
  root.querySelectorAll(".store-status-form").forEach(
    (form) =>
      (form.onsubmit = run(async () => {
        await api("/stores/" + form.dataset.id, {
          method: "PATCH",
          body: JSON.stringify({
            status: form.elements.status.value,
            open: form.elements.open.checked,
          }),
        });
        await refreshOperations();
      })),
  );
  root.querySelector("#accountForm")?.addEventListener(
    "submit",
    run(async (event) => {
      const v = Object.fromEntries(new FormData(event.target));
      v.regionIds = new FormData(event.target).getAll("regionIds");
      state.credential = await post("/accounts", v);
      await refreshOperations();
    }),
  );
  root.querySelector("#hideCredential")?.addEventListener("click", () => {
    state.credential = null;
    render();
  });
  root.querySelector("#productForm")?.addEventListener(
    "submit",
    run(async (event) => {
      const v = Object.fromEntries(new FormData(event.target));
      v.active = event.target.elements.active.checked;
      v.price = Number(v.price);
      v.stock = Number(v.stock);
      v.imageUrl=await formImage(event.target,v.storeId||state.staff.storeId);
      delete v.imageFile;delete v.imagePermission;
      await post("/products", v);
      await loadView();
    }),
  );
  root.querySelectorAll('.store-profile-form').forEach(form=>form.onsubmit=run(async()=>{const v=Object.fromEntries(new FormData(form));v.imageUrl=await formImage(form,form.dataset.id);delete v.imageFile;delete v.imagePermission;await api('/stores/'+form.dataset.id+'/profile',{method:'PATCH',body:JSON.stringify({...v,version:Number(form.dataset.version),deliveryFee:Number(v.deliveryFee),minimumOrder:Number(v.minimumOrder)})});await refreshOperations()}));
  root.querySelector('#manageStore')?.addEventListener('change',()=>loadManagedProducts().catch(err=>message(err.message,true)));
  if (['merchant','operator'].includes(state.staff?.role) && ['staff','operations'].includes(view()))
    loadManagedProducts().catch((error) => message(error.message, true));
}
async function loadManagedProducts() {
  const managedStore=state.staff?.storeId||root.querySelector("#manageStore")?.value;
  if (!managedStore || !root.querySelector("#managedProducts")) return;
  const rows = await api("/products?storeId=" + managedStore),
    node = root.querySelector("#managedProducts");
  node.innerHTML =
    '<ul class="data-list">' +
    rows
      .map(
        (p) =>
          `<li><strong>${e(p.title)}</strong><form class="product-update form-grid" data-id="${p.id}" data-version="${p.version}"><label>상품명<input name="title" value="${e(p.title)}" maxlength="80" required></label><label>분류<select name="category">${Object.entries(categoryNames).map(([id,name])=>`<option value="${id}"${p.category===id?' selected':''}>${e(name)}</option>`).join('')}</select></label><label>소분류<select name="subcategory">${[['','미지정'],...leaves[p.category]].map(([id,name])=>`<option value="${id}"${p.subcategory===id?' selected':''}>${e(name)}</option>`).join('')}</select></label><label>구성·중량<input name="unit" value="${e(p.unit)}" maxlength="40" required></label><label>원산지·표시<input name="origin" value="${e(p.origin)}" maxlength="200" required></label><label>보관<select name="storage">${[['ambient','실온'],['chilled','냉장'],['frozen','냉동']].map(([id,name])=>`<option value="${id}"${p.storage===id?' selected':''}>${name}</option>`).join('')}</select></label><label class="wide">상품 설명<textarea name="description" maxlength="2000">${e(p.description)}</textarea></label>${imageFields(p.image_url)}<label>판매가<input name="price" type="number" min="1" max="100000000" value="${p.price}" required></label><label>판매가능 재고<input name="stock" type="number" min="0" max="100000" value="${p.stock}" required></label><label class="check"><input name="active" type="checkbox"${p.active ? " checked" : ""}>공개</label><button>저장</button></form><button data-delete-product="${p.id}">삭제</button></li>`,
      )
      .join("") +
    "</ul>";
  node.querySelectorAll(".product-update").forEach(
    (f) =>
      (f.onsubmit = run(async () => {
        const value=Object.fromEntries(new FormData(f));value.imageUrl=await formImage(f,managedStore);delete value.imageFile;delete value.imagePermission;
        await api("/products/" + f.dataset.id, {
          method: "PATCH",
          body: JSON.stringify({
            ...value,version:Number(f.dataset.version),
            price: Number(f.elements.price.value),
            stock: Number(f.elements.stock.value),
            active: f.elements.active.checked,
          }),
        });
        await loadManagedProducts();
      })),
  );
  node.querySelectorAll('.product-update [name=category]').forEach(select=>select.onchange=()=>{select.form.elements.subcategory.innerHTML=[['','미지정'],...leaves[select.value]].map(([id,name])=>`<option value="${id}">${e(name)}</option>`).join('')});
  node.querySelectorAll("[data-delete-product]").forEach(
    (b) =>
      (b.onclick = run(async () => {
        if (
          !confirm(
            "이 상품을 판매 목록에서 삭제할까요? 기존 주문 내역은 유지됩니다.",
          )
        )
          return;
        await api("/products/" + b.dataset.deleteProduct, { method: "DELETE" });
        await loadManagedProducts();
      })),
  );
}
async function refreshOperations() {
  state.ops = await api("/operations");
  state.regions = state.ops.regions.filter((r) => r.active);
  render();
}
async function initialize() {
  try {
    const [config, session, regions] = await Promise.all([
      api("/config"),
      api("/session"),
      api("/regions"),
    ]);
    state.config = config;
    state.staff = session.staff;
    state.customer = session.customer;
    state.regions = regions;
    state.connected = true;
    if (window.ARIRANG_MEMBER_AUTH) {
      try {
        state.memberSettings = await window.ARIRANG_MEMBER_AUTH.ready;
        state.recovery =
          window.ARIRANG_MEMBER_RECOVERY ||
          new URLSearchParams(location.search).get("memberRecovery") === "1";
        await refreshMember();
      } catch (error) {
        state.authError = "회원 인증 연결을 확인해 주세요. " + error.message;
      }
    }
    let saved;
    try {
      saved =
        selectedDelivery()?.region_id ||
        new URLSearchParams(location.search).get("region") ||
        localStorage.getItem("arirang-delivery-region");
    } catch {}
    if (regions.some((r) => r.id === saved)) await chooseRegion(saved, false);
    else {
      try {
        await locate(false);
        if (!state.region && navigator.permissions) {
          const p = await navigator.permissions.query({ name: "geolocation" });
          if (p.state === "granted") await locate(true);
        }
      } catch (error) {
        state.locationNote = error.message;
      }
    }
    if (
      state.savedBasket?.regionId === state.region?.id &&
      state.stores.some((v) => v.id === state.savedBasket.storeId)
    ) {
      await chooseStore(state.savedBasket.storeId);
      state.filterStore = false;
    }
    if (selectedDelivery() && !selectedDelivery().region_id)
      await applyDelivery();
    if (state.recovery) location.hash = "#member";
    await loadView();
  } catch (error) {
    state.connected = false;
    message(error.message, true);
    render();
  }
}
document
  .querySelector('[data-customer-view="shop"]')
  ?.addEventListener("click", (ev) => {
    ev.preventDefault();
    state.filterStore = false;
    setBrowse({ major: "all", category: "all", leaf: "", search: "" });
    if (view() !== "shop") location.hash = "#shop";
  });
document.getElementById("marketSearch")?.addEventListener("submit", (ev) => {
  ev.preventDefault();
  state.filterStore = false;
  setBrowse({ search: ev.target.elements.q.value });
  if (view() !== "shop") location.hash = "#shop";
  root.querySelector("#catalogTitle")?.focus();
});
window.addEventListener("arirang:member-logout", () => {
  state.member = null;
  state.customer = null;
  state.addresses = [];
  state.selectedAddressId = null;
  state.addressEdit = null;
  state.orders = [];
  render();
});
window.addEventListener("popstate", () => {
  readBrowse();
  loadView().catch((error) => message(error.message, true));
});
window.addEventListener("hashchange", () =>
  loadView().catch((error) => message(error.message, true)),
);
setInterval(() => {
  if (
    state.connected &&
    !document.hidden &&
    ["orders", "staff"].includes(view()) &&
    !document.activeElement?.matches("input,textarea,select")
  )
    loadView().catch((error) => message(error.message, true));
}, 15000);
initialize();
