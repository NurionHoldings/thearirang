import { randomUUID, createHash } from "node:crypto";
export class MarketError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const uuid = () => randomUUID();
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const text = (v, max = 100) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw new MarketError("필수 입력값과 길이를 확인하세요.");
  return v.trim();
};
export const optional = (v, max = 500) =>
  v == null || v === "" ? "" : text(v, max);
export function identifier(v) {
  if (
    typeof v !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      v,
    )
  )
    throw new MarketError("식별자를 확인하세요.");
  return v;
}
export function integer(v, min, max) {
  if (!Number.isSafeInteger(v) || v < min || v > max)
    throw new MarketError("금액·수량 범위를 확인하세요.");
  return v;
}
export const categories = [
  "fruit",
  "vegetables",
  "meat",
  "seafood",
  "dairy",
  "grains",
  "ready-meals",
  "frozen",
  "snacks",
  "drinks",
  "bakery",
  "condiments",
];
const norm = (v) => {
  const value = String(v || "")
    .normalize("NFKC")
    .replace(/\s/g, "")
    .replace(/특별자치도$|특별자치시$|특별시$|광역시$/, "")
    .toLowerCase();
  return (
    {
      경기도: "경기",
      강원도: "강원",
      제주도: "제주",
      충청남도: "충남",
      충청북도: "충북",
      전라남도: "전남",
      전라북도: "전북",
      경상남도: "경남",
      경상북도: "경북",
    }[value] || value
  );
};
export function regionMatches(region, place) {
  return (
    region.active &&
    norm(region.province) === norm(place.province) &&
    norm(region.city) === norm(place.city) &&
    (region.level === "city" ||
      norm(region.district) === norm(place.district)) &&
    (region.level !== "dong" || norm(region.dong) === norm(place.dong))
  );
}
export function bestRegion(regions, place) {
  return (
    regions
      .filter((r) => regionMatches(r, place))
      .sort(
        (a, b) =>
          ({ city: 1, district: 2, dong: 3 })[b.level] -
          { city: 1, district: 2, dong: 3 }[a.level],
      )[0] || null
  );
}
export function placeFromKakao(row) {
  const metro = [
    "서울",
    "부산",
    "대구",
    "인천",
    "광주",
    "대전",
    "울산",
    "세종",
  ].includes(norm(row.region_1depth_name));
  const second = row.region_2depth_name || "",
    match = second.match(/^(.+?시)(.*구)?$/);
  return {
    province: row.region_1depth_name,
    city: metro ? norm(row.region_1depth_name) : match?.[1] || second,
    district: metro ? second : match?.[2] || "",
    dong: row.region_3depth_h_name || row.region_3depth_name || "",
    regionType: row.region_type || "B",
    code: row.code || "",
  };
}
export function ipRegion(regions, geo = {}) {
  const city = norm(geo.city),
    matches = regions.filter(
      (r) =>
        r.active &&
        (norm(r.city) === city ||
          (r.aliases || []).some((a) => norm(a) === city)),
    );
  const direct = matches.filter((r) => r.level === "city");
  return {
    region: direct.length === 1 ? direct[0] : null,
    candidates: matches,
    precision: "city",
    source: "ip",
  };
}
export function regionInput(v) {
  const level = text(v.level, 10),
    city_type = text(v.cityType, 10);
  if (
    !["city", "district", "dong"].includes(level) ||
    !["small", "large"].includes(city_type)
  )
    throw new MarketError("지역 구분을 확인하세요.");
  const r = {
    name: text(v.name, 60),
    province: norm(text(v.province, 30)),
    city: norm(text(v.city, 30)),
    district: optional(v.district, 30),
    dong: optional(v.dong, 30),
    level,
    city_type,
    active: v.active === true,
    aliases: Array.isArray(v.aliases)
      ? v.aliases.slice(0, 8).map((a) => text(a, 40))
      : [],
  };
  if (
    (city_type === "small" && (level !== "city" || r.district || r.dong)) ||
    (city_type === "large" &&
      (level === "city" || !r.district || (level === "dong" && !r.dong)))
  )
    throw new MarketError(
      "소도시는 시 단위, 대도시는 구/동 단위로 입력하세요.",
    );
  return r;
}
export function orderInput(v) {
  if (v.consent !== true)
    throw new MarketError("주문·배송 정보 이용 안내를 확인하세요.");
  const items = Array.isArray(v.items) ? v.items : [];
  if (!items.length || items.length > 50)
    throw new MarketError("한 업체에서 1~50종을 선택하세요.");
  const seen = new Set();
  const lines = items
    .map((p) => {
      const productId = identifier(p.productId);
      if (seen.has(productId)) throw new MarketError("중복 상품입니다.");
      seen.add(productId);
      return { productId, quantity: integer(p.quantity, 1, 100) };
    })
    .sort((a, b) => a.productId.localeCompare(b.productId));
  const phone = text(v.phone, 20).replace(/[-\s]/g, "");
  if (!/^01[016789]\d{7,8}$/.test(phone))
    throw new MarketError("연락처를 확인하세요.");
  return {
    storeId: identifier(v.storeId),
    regionId: identifier(v.regionId),
    addressCheckId: identifier(v.addressCheckId),
    idempotencyKey: identifier(v.idempotencyKey),
    items: lines,
    expectedTotal: integer(v.expectedTotal, 1, 9007199254740991),
    customerName: text(v.customerName, 40),
    phone,
    addressDetail: text(v.addressDetail, 200),
  };
}
export function safeOrder(row, actor) {
  const own = actor.role === "customer" && row.customer_id === actor.id,
    operator = actor.role === "operator",
    merchant = actor.role === "merchant",
    assigned =
      actor.role === "rider" &&
      row.rider_id === actor.id &&
      !["cancelled", "rejected", "delivered"].includes(row.status);
  const data = {
    id: row.id,
    storeId: row.store_id,
    regionId: row.region_id,
    status: row.status,
    riderId: row.rider_id,
    items: row.items,
    subtotal: Number(row.subtotal),
    deliveryFee: row.delivery_fee,
    total: Number(row.total),
    paymentMethod: row.payment_method,
    paymentState: row.payment_state,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (own || operator || merchant || assigned)
    Object.assign(data, {
      customerName: row.customer_name,
      phone: row.phone,
      addressBase: row.address_base,
      addressDetail: row.address_detail,
    });
  if (own) data.deliveryCode = row.delivery_code;
  return data;
}
