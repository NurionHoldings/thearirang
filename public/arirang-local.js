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
const categoryNames = {
  fruit: "과일",
  vegetables: "채소",
  meat: "정육·계란",
  seafood: "수산",
  dairy: "유제품",
  grains: "쌀·잡곡",
  "ready-meals": "간편식·밀키트",
  frozen: "냉동식품",
  snacks: "과자·간식",
  drinks: "생수·음료",
  bakery: "베이커리",
  condiments: "양념·소스",
};
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
  regions: [],
  stores: [],
  products: [],
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
  ["shop", "orders", "staff", "operations"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "shop";
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
  const stores = await api("/stores?region=" + encodeURIComponent(id));
  state.region = r;
  state.store = null;
  state.products = [];
  state.basket = {};
  state.stores = stores;
  resetCheckout();
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
  state.store = s;
  state.products = await api("/products?storeId=" + id);
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
  state.search = "";
  state.category = categoryNames[
    new URLSearchParams(location.search).get("category")
  ]
    ? new URLSearchParams(location.search).get("category")
    : "all";
  resetCheckout();
  render();
}
function basketView() {
  const rows = basketItems(),
    subtotal = rows.reduce((a, p) => a + p.price * p.quantity, 0);
  return `<aside class="local-basket"><div class="section-title"><h2>이 업체 장바구니</h2><span>${rows.length}종 / 최대 50종</span></div>${rows.length ? rows.map((p) => `<div class="basket-row"><div><strong>${e(p.title)}</strong><small>${won(p.price)} · ${e(p.unit)}</small></div><div class="quantity"><button data-qty="${p.id}" data-delta="-1" aria-label="${e(p.title)} 수량 줄이기">−</button><span>${p.quantity}</span><button data-qty="${p.id}" data-delta="1" aria-label="${e(p.title)} 수량 늘리기"${p.quantity >= Math.min(p.stock, 100) ? " disabled" : ""}>+</button></div></div>`).join("") : '<p class="muted">한 업체의 상품을 담아 주세요.</p>'}<div class="basket-total"><span>상품 합계</span><b>${won(subtotal)}</b><span>업체 배송비</span><b>${won(state.store.deliveryFee)}</b><span>예상 합계</span><strong>${won(subtotal + state.store.deliveryFee)}</strong></div><p class="muted">최소 상품금액 ${won(state.store.minimumOrder)} · 현장결제 · 실제 결제 확인은 별도</p>${rows.length ? checkoutForm(subtotal) : ""}</aside>`;
}
function checkoutForm(subtotal) {
  return `<form id="checkoutForm"><h3>배송 정보</h3><p class="muted">${e(state.region.name)} 배송 구역 · 주소 확인 후 주문할 수 있습니다.</p><label>받는 분<input name="customerName" maxlength="40" required autocomplete="name"></label><label>연락처<input name="phone" maxlength="20" required autocomplete="tel" inputmode="tel"></label><label>도로명 또는 지번 주소<input name="addressBase" maxlength="200" required autocomplete="street-address"></label><label>상세주소<input name="addressDetail" maxlength="200" required placeholder="동·호수 / 건물 내 위치"></label><button type="button" id="checkAddress"${state.config.liveOrders ? "" : " disabled"}>배송 지역·주소 확인</button><p id="addressResult" class="muted">주소가 업체 배송 구역에 포함되는지 서버에서 확인합니다.</p><label class="check"><input name="consent" type="checkbox" required> 주문 확인·배송 연락에 필요한 이름·전화·주소 이용에 동의합니다.</label>${state.config.privacyURL ? `<a href="${e(state.config.privacyURL)}" target="_blank" rel="noopener">개인정보 처리 안내 ↗</a>` : '<p class="muted">개인정보 처리 안내 연결 준비 중</p>'}<p class="payment-note">현장결제 · 온라인 카드결제 미연결</p><button type="submit" class="primary"${state.config.liveOrders && subtotal >= state.store.minimumOrder ? "" : " disabled"}>${won(subtotal + state.store.deliveryFee)} 현장결제 주문 접수</button></form>`;
}
function shop() {
  return `<section class="region-panel"><img class="regional-grocery-art" src="assets/arirang-market-online.svg" width="260" height="210" alt="신선한 식재료를 담은 장바구니"><p class="eyebrow">NEARBY ARIRANG MARKET</p><h1>내 지역에서 장보기</h1><p>소도시는 시 단위, 대도시는 구·동 단위로 연결합니다.</p><div class="region-controls"><select id="regionSelect" aria-label="판매·배송 지역">${regionOptions(state.region?.id)}</select><button id="locate">내 위치로 연결</button><button id="autoRegion">접속 지역 자동 연결</button></div><p class="muted">${e(state.locationNote)} · 위치 좌표는 지역 확인에만 사용하며 저장하지 않습니다.</p></section>${!state.region ? `<div class="empty"><h2>${state.regions.length ? "배송 지역을 선택해 주세요." : "등록된 운영 지역이 없습니다."}</h2><p>운영자가 지역과 입점업체를 등록하면 해당 지역에서 장보기와 주문이 가능합니다.</p></div>` : `<section><div class="section-title"><h2>${e(state.region.name)} 입점업체</h2><span>${state.stores.length}개 지역 업체</span></div><div class="store-grid">${state.stores.length ? state.stores.map((s) => `<button class="store-card${s.id === state.store?.id ? " selected" : ""}" data-store="${s.id}"><strong>${e(s.name)}</strong><span>${e(s.address)}</span><small>최소 주문 ${won(s.minimumOrder)} · 배송비 ${won(s.deliveryFee)}</small><b>이 업체 상품 보기 →</b></button>`).join("") : '<p class="muted">현재 이 구역에서 주문을 받는 업체가 없습니다. 다른 지역을 선택해 주세요.</p>'}</div></section>`}${
    state.store
      ? `<section class="store-shopping"><div><div class="section-title"><div><p class="eyebrow">${e(state.region.name)}</p><h2>${e(state.store.name)}</h2></div><span>${state.products.length}개 등록 상품</span></div><nav class="food-filters" aria-label="상품 분류"><button data-category="all"${state.category === "all" ? ' aria-current="true"' : ""}>전체</button>${[...new Set(state.products.map((p) => p.category))].map((c) => `<button data-category="${c}"${state.category === c ? ' aria-current="true"' : ""}>${e(categoryNames[c])}</button>`).join("")}</nav><label class="product-search">상품 검색<input id="productSearch" type="search" placeholder="상품명·원산지·구성 검색" value="${e(state.search)}"></label><div class="product-grid">${
          state.products
            .filter(
              (p) =>
                (state.category === "all" || p.category === state.category) &&
                [p.title, p.origin, p.unit, p.description]
                  .join(" ")
                  .toLocaleLowerCase()
                  .includes(state.search.toLocaleLowerCase()),
            )
            .map(
              (p) =>
                `<article class="product-card"><span class="product-category">${e(categoryNames[p.category])}</span><h3>${e(p.title)}</h3><p>${e(p.unit)} · ${e(p.origin)}</p><p class="muted">${e(p.description)}</p><strong>${won(p.price)}</strong><small>판매가능 ${p.stock}개 · ${{ ambient: "실온", chilled: "냉장", frozen: "냉동" }[p.storage]}</small><button data-add="${p.id}"${p.stock ? "" : " disabled"}>${p.stock ? "장바구니 담기" : "품절"}</button></article>`,
            )
            .join("") || '<p class="muted">등록된 상품이 없습니다.</p>'
        }</div></div>${basketView()}</section>`
      : ""
  }`;
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
  return `<div class="section-title"><div><p class="eyebrow">MY ORDERS</p><h1>이 기기의 주문 내역</h1></div><button id="refreshOrders">새로고침</button></div><p class="muted">주문 내역은 이 브라우저의 구매자 세션에서만 열람합니다. 접수 대기 15분 초과 주문은 자동 정리 시 취소·재고 반환되며, 만료 후 접수는 차단됩니다.</p>${state.orders.length ? state.orders.map((o) => orderCard(o, "customer")).join("") : '<div class="empty"><h2>확인할 주문이 없습니다.</h2><a href="#shop">내 지역 장보기 →</a></div>'}`;
}
function login() {
  return `<section class="login-panel"><p class="eyebrow">PARTNER WORKSPACE</p><h1>판매자·라이더·운영자 접속</h1><p>운영자가 발급한 계정으로 접속하세요. 구매자는 별도 파트너 로그인이 필요하지 않습니다.</p><form id="staffLogin"><label>접속 유형<select name="role"><option value="staff">판매자·라이더 발급 계정</option><option value="operator">플랫폼 운영자</option></select></label><label id="partnerUsername">계정<input name="username" maxlength="60" required autocomplete="username"></label><label>비밀번호<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="current-password"></label><button class="primary">접속</button></form><p class="muted">플랫폼 운영자 비밀번호는 Netlify의 ARIRANG_MARKET_OPERATOR_PASSWORD(12자 이상)로 설정합니다. 층별·자료업로드 비밀번호는 주문 시스템 권한으로 사용하지 않습니다.</p></section>`;
}
function staffWorkspace() {
  if (!state.staff) return login();
  const role = state.staff.role;
  return `<div class="section-title"><div><p class="eyebrow">${e(role.toUpperCase())} WORKSPACE</p><h1>${{ merchant: "판매자 주문 접수", rider: "라이더 배송", operator: "운영자 주문·배차" }[role]}</h1></div><div><button id="refreshOrders">새로고침</button><button id="staffLogout">로그아웃</button></div></div>${role === "rider" ? `<label class="check duty"><input id="riderDuty" type="checkbox"${state.staff.onDuty ? " checked" : ""}> 현재 근무 중 · 지정 지역 배송 요청 받기</label><p class="muted">기본 단건 배차입니다. 배송 수락 → 픽업 확인 → 고객 인계번호 확인 순서로 처리합니다.</p>` : '<p class="muted">접수 → 상품 준비 → 픽업 준비 완료 순서로 처리합니다. 배송 완료는 배정된 라이더가 인계 확인 후 처리합니다.</p>'}${role === "merchant" ? `<label class="check duty"><input id="merchantOpen" type="checkbox"${state.ops?.stores[0]?.open ? " checked" : ""}${state.ops?.stores[0]?.status === "active" ? "" : " disabled"}> 현재 주문 받기</label><details class="operations-panel"><summary>내 업체 상품 등록 · 최대 50개</summary>${productForm()}<div id="managedProducts"></div></details>` : ""}${state.orders.length ? state.orders.map((o) => orderCard(o, "staff")).join("") : '<div class="empty"><h2>현재 처리할 주문이 없습니다.</h2><p>접수된 주문과 지정 지역의 배송 요청이 이곳에 표시됩니다.</p></div>'}`;
}
function productForm() {
  return `<form id="productForm" class="form-grid">${state.staff.role === "operator" ? `<label>입점업체<select name="storeId" required>${options(state.ops.stores)}</select></label>` : ""}<label>상품명<input name="title" maxlength="80" required></label><label>상품 분류<select name="category">${Object.entries(
    categoryNames,
  )
    .map(([id, name]) => `<option value="${id}">${name}</option>`)
    .join(
      "",
    )}</select></label><label>구성·중량<input name="unit" maxlength="40" required></label><label>판매가 (원)<input name="price" type="number" min="1" max="100000000" step="1" required></label><label>판매가능 수량<input name="stock" type="number" min="0" max="100000" step="1" required></label><label>원산지·표시 정보<input name="origin" maxlength="200" required></label><label>보관 방식<select name="storage"><option value="ambient">실온</option><option value="chilled">냉장</option><option value="frozen">냉동</option></select></label><label class="wide">상품 설명<textarea name="description" maxlength="2000"></textarea></label><label class="check"><input type="checkbox" name="active"> 상품 공개</label><button class="primary">상품 등록</button></form>`;
}
function operations() {
  if (!state.staff) return login();
  if (state.staff.role !== "operator")
    return '<div class="empty"><h1>운영자 권한이 필요합니다.</h1><a href="#staff">내 업무 화면으로 →</a></div>';
  const data = state.ops;
  if (!data) return "<p>운영 정보를 불러오고 있습니다.</p>";
  return `<div class="section-title"><div><p class="eyebrow">MULTI-REGION OPERATIONS</p><h1>지역·입점업체·라이더 관리</h1></div><button id="staffLogout">로그아웃</button></div><p class="capacity">전체 입점 정원 ${data.vendorCount} / 100개 · 업체별 상품 최대 50개</p><section class="operations-panel"><h2>1. 판매·배송 지역 등록</h2><p class="muted">소도시는 시 전체, 대도시는 구 또는 동으로 나눕니다. 자동 연결용 영문 도시명은 IP 도시 별칭에 입력하세요.</p><form id="regionForm" class="form-grid"><label>표시 이름<input name="name" maxlength="60" required placeholder="예: 대전 동구 홍도동"></label><label>도시 구분<select name="cityType"><option value="small">소도시</option><option value="large">대도시</option></select></label><label>시·도<input name="province" required placeholder="예: 충남 / 대전 / 서울"></label><label>시 이름<input name="city" required placeholder="예: 공주시 / 대전 / 서울"></label><label>권역 단위<select name="level"><option value="city">시 단위</option><option value="district">구 단위</option><option value="dong">동 단위</option></select></label><label>구 이름<input name="district" placeholder="대도시만 입력"></label><label>동 이름<input name="dong" placeholder="동 단위일 때 입력"></label><label>IP 도시 별칭<input name="aliases" placeholder="예: daejeon (쉼표 구분)"></label><label class="check"><input name="active" type="checkbox"> 지역 운영 활성화</label><button class="primary">지역 등록</button></form><ul class="data-list">${data.regions.map((r) => `<li><strong>${e(r.name)}</strong><span>${e(r.level)} · ${r.active ? "활성" : "비활성"}</span><button data-region-toggle="${r.id}" data-active="${!r.active}">${r.active ? "운영 중지" : "운영 시작"}</button></li>`).join("") || "<li>등록된 지역 없음</li>"}</ul></section><section class="operations-panel"><h2>2. 입점업체와 배송 구역</h2><form id="storeForm" class="form-grid"><label>업체명<input name="name" maxlength="60" required></label><label>업체 소재 지역<select name="regionId" required>${options(data.regions)}</select></label><label class="wide">업체 주소<input name="address" maxlength="200" required></label><label>배송비 (원)<input name="deliveryFee" type="number" min="0" max="1000000" step="1" required></label><label>최소 주문 상품금액<input name="minimumOrder" type="number" min="0" max="100000000" step="1" required></label><label class="wide">배송 가능 지역 (여러 개 선택)<select name="serviceRegions" multiple size="4">${data.regions.map((r) => `<option value="${r.id}">${e(r.name)}</option>`).join("")}</select></label><button class="primary">업체 심사 대기로 등록</button></form><div class="data-list">${data.stores.map((s) => `<form class="store-status-form" data-id="${s.id}"><strong>${e(s.name)}</strong><select name="status">${["pending", "active", "suspended", "rejected"].map((v) => `<option value="${v}"${s.status === v ? " selected" : ""}>${{ pending: "심사 대기", active: "승인", suspended: "일시 중단", rejected: "반려" }[v]}</option>`).join("")}</select><label class="check"><input type="checkbox" name="open"${s.open ? " checked" : ""}> 주문 받기</label><button>상태 저장</button></form>`).join("")}</div></section><section class="operations-panel"><h2>3. 판매자·라이더 계정 발급</h2><form id="accountForm" class="form-grid"><label>역할<select name="role"><option value="merchant">판매자</option><option value="rider">라이더</option></select></label><label>계정명<input name="username" maxlength="60" required autocomplete="off"></label><label>표시 이름<input name="name" maxlength="40" required></label><label>판매자 소속 업체<select name="storeId">${options(data.stores)}</select></label><label class="wide">라이더 활동 지역 (여러 개 선택)<select name="regionIds" multiple size="4">${data.regions.map((r) => `<option value="${r.id}">${e(r.name)}</option>`).join("")}</select></label><button class="primary">계정·비밀번호 발급</button></form>${state.credential ? `<div class="credential"><strong>발급 결과 · 이 화면에서만 확인</strong><p>계정 ${e(state.credential.username)}</p><code>${e(state.credential.password)}</code><button id="hideCredential">발급 결과 숨기기</button></div>` : ""}<ul class="data-list">${data.accounts.map((a) => `<li><strong>${e(a.name)}</strong><span>${e(a.username)} · ${e(a.role)} · ${a.active ? (a.on_duty ? "근무 중" : "대기") : "비활성"}</span><button data-account-toggle="${a.id}" data-active="${!a.active}">${a.active ? "접속 중지" : "접속 허용"}</button><button data-password-reset="${a.id}">비밀번호 재발급</button></li>`).join("")}</ul></section><section class="operations-panel"><h2>4. 업체 상품 등록</h2>${productForm()}</section><p><a href="#staff">주문·배차 관리로 이동 →</a></p>`;
}
async function loadView() {
  if (!state.connected) return;
  const v = view();
  if (v === "orders") {
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
  document
    .querySelectorAll(".local-tabs [data-view]")
    .forEach((a) =>
      a.setAttribute(
        "aria-current",
        a.dataset.view === view() ? "page" : "false",
      ),
    );
  const banner = document.getElementById("serviceState");
  banner.textContent = state.connected
    ? state.config.liveOrders
      ? "지역 기반 현장결제 주문 접수 · 업체별 배송비 · 자체 라이더 배차"
      : "실제 주문 접수 준비 중 · 운영 지역/업체·정책·주소 확인 연결 후 활성화됩니다."
    : "주문 서비스 저장소 연결 준비 중입니다. 운영 안내 페이지를 이용해 주세요.";
  root.innerHTML = !state.connected
    ? '<div class="empty"><h1>지역 주문 서비스를 준비하고 있습니다.</h1><p>저장소 연결과 운영 설정이 완료되면 지역별 업체와 주문·배송 화면이 열립니다.</p><a href="/arirang-market.html">아리랑마켓 안내로 →</a><button id="retryConnection">연결 다시 확인</button></div>'
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
      await task(event);
      message("처리했습니다.");
    } catch (error) {
      message(error.message, true);
    }
  };
}
function bind() {
  root.querySelector("#productSearch")?.addEventListener("input", (ev) => {
    state.search = ev.target.value;
    const position = ev.target.selectionStart;
    render();
    const field = root.querySelector("#productSearch");
    field?.focus();
    try {
      field?.setSelectionRange(position, position);
    } catch {}
  });
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
  root.querySelectorAll("[data-category]").forEach(
    (b) =>
      (b.onclick = () => {
        state.category = b.dataset.category;
        render();
      }),
  );
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
  root
    .querySelectorAll("[data-add]")
    .forEach((b) => (b.onclick = () => changeQuantity(b.dataset.add, 1)));
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
      await post("/products", v);
      event.target.reset();
      await loadManagedProducts();
    }),
  );
  if (state.staff?.role === "merchant" && view() === "staff")
    loadManagedProducts().catch((error) => message(error.message, true));
}
async function loadManagedProducts() {
  if (!state.staff?.storeId || !root.querySelector("#managedProducts")) return;
  const rows = await api("/products?storeId=" + state.staff.storeId),
    node = root.querySelector("#managedProducts");
  node.innerHTML =
    '<ul class="data-list">' +
    rows
      .map(
        (p) =>
          `<li><strong>${e(p.title)}</strong><form class="product-update" data-id="${p.id}"><label>판매가<input name="price" type="number" min="1" max="100000000" value="${p.price}" required></label><label>판매가능 재고<input name="stock" type="number" min="0" max="100000" value="${p.stock}" required></label><label class="check"><input name="active" type="checkbox"${p.active ? " checked" : ""}>공개</label><button>저장</button></form><button data-delete-product="${p.id}">삭제</button></li>`,
      )
      .join("") +
    "</ul>";
  node.querySelectorAll(".product-update").forEach(
    (f) =>
      (f.onsubmit = run(async () => {
        await api("/products/" + f.dataset.id, {
          method: "PATCH",
          body: JSON.stringify({
            price: Number(f.elements.price.value),
            stock: Number(f.elements.stock.value),
            active: f.elements.active.checked,
          }),
        });
        await loadManagedProducts();
      })),
  );
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
    let saved;
    try {
      saved = localStorage.getItem("arirang-delivery-region");
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
    await loadView();
  } catch (error) {
    state.connected = false;
    message(error.message, true);
    render();
  }
}
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
