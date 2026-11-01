import { validLeaf } from "../../../public/market-taxonomy.mjs";
import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  MarketError,
  uuid,
  digest,
  text,
  optional,
  identifier,
  integer,
  categories,
  regionInput,
  orderInput,
  safeOrder,
  regionMatches,
  bestRegion,
  ipRegion,
  placeFromKakao,
} from "./domain.mjs";
const terminal = ["cancelled", "rejected", "delivered"];
const one = async (c, sql, p = []) => (await c.query(sql, p)).rows[0];
export function makeMarketService(
  pool,
  { env = () => undefined, fetcher = fetch } = {},
) {
  const live = () =>
    env("ARIRANG_MARKET_LIVE_ORDERS") === "true" &&
    !!env("KAKAO_REST_API_KEY") &&
    /^https:\/\//.test(env("ARIRANG_MARKET_PRIVACY_URL") || "");
  const transaction = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  };
  const regions = async () =>
    (
      await pool.query(
        "SELECT * FROM market_regions ORDER BY province,city,district,dong,name",
      )
    ).rows;
  const requireRole = (a, ...roles) => {
    if (!a || !roles.includes(a.role))
      throw new MarketError("접속 권한을 확인하세요.", 403);
  };
  const serves = (store, region, all) =>
    store.service_regions.some((id) => {
      const r = all.find((x) => x.id === id);
      return (
        r &&
        regionMatches(r, {
          province: region.province,
          city: region.city,
          district: region.district,
          dong: region.dong,
        })
      );
    });
  const riderServes = (r, region, all) =>
    r.region_ids.some((id) => {
      const x = all.find((v) => v.id === id);
      return x && regionMatches(x, region);
    });
  async function rate(key, limit = 10) {
    const now = Date.now(),
      bucket = Math.floor(now / 60000),
      row = await one(
        pool,
        `INSERT INTO market_rate_limits(key,count,expires_at) VALUES($1,1,now()+interval '2 minutes') ON CONFLICT(key) DO UPDATE SET count=market_rate_limits.count+1 WHERE market_rate_limits.count<$2 RETURNING count`,
        [digest(key) + ":" + bucket, limit],
      );
    if (!row)
      throw new MarketError("요청이 많습니다. 잠시 후 다시 시도하세요.", 429);
  }
  async function session(token) {
    if (!token) return null;
    const row = await one(
      pool,
      "SELECT * FROM market_sessions WHERE token_hash=$1 AND expires_at>now()",
      [digest(token)],
    );
    if (!row) return null;
    if (
      row.role === "operator" &&
      row.actor_id !==
        "operator:" + digest(env("ARIRANG_MARKET_OPERATOR_PASSWORD") || "")
    )
      return null;
    if (["merchant", "rider"].includes(row.role)) {
      const account = await one(
        pool,
        "SELECT * FROM market_accounts WHERE id=$1 AND active=true",
        [row.actor_id],
      );
      if (!account) return null;
      return {
        id: row.actor_id,
        role: row.role,
        storeId: account.store_id,
        regionIds: account.region_ids,
        name: account.name,
        onDuty: account.on_duty,
      };
    }
    return {
      id: row.role === "operator" ? "operator" : row.actor_id,
      role: row.role,
    };
  }
  async function issue(c, id, role) {
    const token = randomBytes(32).toString("hex");
    await c.query(
      "INSERT INTO market_sessions(token_hash,actor_id,role,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')",
      [digest(token), id, role],
    );
    return token;
  }
  async function guest(ip) {
    await rate("guest:" + ip, 10);
    return transaction(async (c) => {
      const id = uuid();
      await c.query("INSERT INTO market_customers(id) VALUES($1)", [id]);
      return {
        token: await issue(c, id, "customer"),
        actor: { id, role: "customer" },
      };
    });
  }
  async function login(v, ip) {
    await rate("login:" + ip, 8);
    const username = v.role === "operator" ? "operator" : text(v.username, 60),
      password = text(v.password, 128);
    let a;
    if (v.role === "operator") {
      const expected = env("ARIRANG_MARKET_OPERATOR_PASSWORD");
      if (!expected || expected.length < 12)
        throw new MarketError(
          "운영자 전용 비밀번호가 아직 설정되지 않았습니다.",
          503,
        );
      if (
        !timingSafeEqual(
          Buffer.from(digest(password)),
          Buffer.from(digest(expected)),
        )
      )
        throw new MarketError("로그인 정보를 확인하세요.", 401);
      a = { id: "operator:" + digest(expected), role: "operator" };
    } else {
      const r = await one(
        pool,
        "SELECT * FROM market_accounts WHERE username=$1 AND active=true",
        [username],
      );
      const computed = scryptSync(
          password,
          r?.salt || "unconfigured-market-salt",
          64,
        ),
        expected = r ? Buffer.from(r.password_hash, "hex") : Buffer.alloc(64);
      if (!r || !timingSafeEqual(computed, expected))
        throw new MarketError("로그인 정보를 확인하세요.", 401);
      a = {
        id: r.id,
        role: r.role,
        storeId: r.store_id,
        regionIds: r.region_ids,
        name: r.name,
        onDuty: r.on_duty,
      };
    }
    return {
      actor: a.role === "operator" ? { id: "operator", role: "operator" } : a,
      token: await issue(pool, a.id, a.role),
    };
  }
  async function logout(token) {
    if (token)
      await pool.query("DELETE FROM market_sessions WHERE token_hash=$1", [
        digest(token),
      ]);
  }
  async function config() {
    return {
      liveOrders: live(),
      preciseLocation: !!env("KAKAO_REST_API_KEY"),
      privacyURL: env("ARIRANG_MARKET_PRIVACY_URL") || "",
      paymentMethod: "pay_on_delivery",
      paymentState: "unverified",
      externalRiderIntegration: false,
    };
  }
  async function resolveLocation(v, geo) {
    const all = (await regions()).filter((r) => r.active);
    if (v?.latitude != null && v?.longitude != null) {
      if (v.consent !== true)
        throw new MarketError("위치 정보 이용 동의가 필요합니다.");
      const x = Number(v.longitude),
        y = Number(v.latitude);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        Math.abs(x) > 180 ||
        Math.abs(y) > 90
      )
        throw new MarketError("위치 값을 확인하세요.");
      const key = env("KAKAO_REST_API_KEY");
      if (!key)
        return { ...ipRegion(all, geo), reason: "precise_unconfigured" };
      const r = await fetcher(
        `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${x}&y=${y}`,
        {
          headers: { Authorization: "KakaoAK " + key },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!r.ok)
        throw new MarketError(
          "정확한 지역 확인에 실패했습니다. 지역을 직접 선택해 주세요.",
          502,
        );
      const result = await r.json();
      const found = (result.documents || [])
        .map(placeFromKakao)
        .map((p) => bestRegion(all, p))
        .filter(Boolean)
        .sort(
          (a, b) =>
            ({ city: 1, district: 2, dong: 3 })[b.level] -
            { city: 1, district: 2, dong: 3 }[a.level],
        )[0];
      return {
        region: found || null,
        source: "geolocation",
        precision: found?.level || "unknown",
        candidates: [],
      };
    }
    return ipRegion(all, geo);
  }
  async function publicStores(regionId) {
    identifier(regionId);
    const all = await regions(),
      r = all.find((x) => x.id === regionId && x.active);
    if (!r) throw new MarketError("운영 지역을 선택하세요.", 404);
    return (
      await pool.query(
        "SELECT * FROM market_stores WHERE status='active' AND open=true ORDER BY name",
      )
    ).rows
      .filter((s) => serves(s, r, all))
      .map((s) => ({
        id: s.id,
        name: s.name,
        regionId: s.region_id,
        address: s.address,
        deliveryFee: s.delivery_fee,
        minimumOrder: s.minimum_order,
      }));
  }
  async function catalog(regionId) {
    const stores = await publicStores(regionId);
    if (!stores.length) return [];
    const ids = stores.map((s) => s.id);
    const rows = (
      await pool.query(
        "SELECT id,store_id,title,category,subcategory,unit,price,stock,description,origin,storage FROM market_products WHERE store_id=ANY($1::uuid[]) AND active=true AND deleted=false ORDER BY title",
        [ids],
      )
    ).rows;
    return rows.map((p) => ({
      ...p,
      storeName: stores.find((s) => s.id === p.store_id).name,
    }));
  }
  async function products(storeId, actor) {
    identifier(storeId);
    const s = await one(pool, "SELECT * FROM market_stores WHERE id=$1", [
      storeId,
    ]);
    if (!s) throw new MarketError("업체를 찾을 수 없습니다.", 404);
    const privileged =
      actor &&
      (actor.role === "operator" ||
        (actor.role === "merchant" && actor.storeId === storeId));
    if (!privileged && (s.status !== "active" || !s.open))
      throw new MarketError("현재 주문을 받지 않는 업체입니다.", 409);
    return (
      await pool.query(
        "SELECT * FROM market_products WHERE store_id=$1 AND deleted=false" +
          (privileged ? "" : " AND active=true") +
          " ORDER BY title",
        [storeId],
      )
    ).rows;
  }
  async function createRegion(actor, v) {
    requireRole(actor, "operator");
    const r = regionInput(v),
      id = uuid();
    await pool.query(
      "INSERT INTO market_regions(id,name,province,city,district,dong,city_type,level,aliases,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)",
      [
        id,
        r.name,
        r.province,
        r.city,
        r.district,
        r.dong,
        r.city_type,
        r.level,
        JSON.stringify(r.aliases),
        r.active,
      ],
    );
    return { id, ...r };
  }
  async function createStore(actor, v) {
    requireRole(actor, "operator");
    const name = text(v.name, 60),
      regionId = identifier(v.regionId),
      serviceRegions =
        Array.isArray(v.serviceRegions) && v.serviceRegions.length
          ? v.serviceRegions.map(identifier)
          : [regionId];
    const all = await regions();
    if (
      serviceRegions.length > 40 ||
      !serviceRegions.every((id) => all.some((r) => r.id === id)) ||
      !all.some((r) => r.id === regionId)
    )
      throw new MarketError("등록된 배송 구역을 선택하세요.");
    return transaction(async (c) => {
      const capacity = await one(
        c,
        "SELECT vendor_count FROM market_capacity WHERE id=1 FOR UPDATE",
      );
      if (capacity.vendor_count >= 100)
        throw new MarketError("전체 입점업체 정원 100개가 찼습니다.", 409);
      const id = uuid();
      await c.query(
        "INSERT INTO market_stores(id,name,region_id,service_regions,address,status,delivery_fee,minimum_order) VALUES($1,$2,$3,$4::jsonb,$5,'pending',$6,$7)",
        [
          id,
          name,
          regionId,
          JSON.stringify([...new Set(serviceRegions)]),
          text(v.address, 200),
          integer(v.deliveryFee, 0, 1000000),
          integer(v.minimumOrder, 0, 100000000),
        ],
      );
      await c.query(
        "UPDATE market_capacity SET vendor_count=vendor_count+1 WHERE id=1",
      );
      return { id, name };
    });
  }
  async function storeState(actor, id, v) {
    requireRole(actor, "operator");
    identifier(id);
    if (!["active", "pending", "suspended", "rejected"].includes(v.status))
      throw new MarketError("업체 상태를 확인하세요.");
    return transaction(async (c) => {
      await one(c, "SELECT * FROM market_capacity WHERE id=1 FOR UPDATE");
      const s = await one(
        c,
        "SELECT * FROM market_stores WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!s) throw new MarketError("업체를 찾을 수 없습니다.", 404);
      if (s.status === "rejected" && v.status !== "rejected") {
        const n = await one(
          c,
          "SELECT vendor_count FROM market_capacity WHERE id=1",
        );
        if (n.vendor_count >= 100)
          throw new MarketError("입점업체 정원 100개가 찼습니다.", 409);
        await c.query(
          "UPDATE market_capacity SET vendor_count=vendor_count+1 WHERE id=1",
        );
      }
      if (s.status !== "rejected" && v.status === "rejected")
        await c.query(
          "UPDATE market_capacity SET vendor_count=vendor_count-1 WHERE id=1",
        );
      await c.query("UPDATE market_stores SET status=$2,open=$3 WHERE id=$1", [
        id,
        v.status,
        v.status === "active" && v.open === true,
      ]);
      return { ok: true };
    });
  }
  async function account(actor, v) {
    requireRole(actor, "operator");
    if (!["merchant", "rider"].includes(v.role))
      throw new MarketError("역할을 선택하세요.");
    const name = text(v.name, 40),
      username = text(v.username, 60),
      storeId = v.role === "merchant" ? identifier(v.storeId) : null,
      regionIds = v.role === "rider" ? (v.regionIds || []).map(identifier) : [];
    const all = await regions();
    if (
      v.role === "rider" &&
      (!regionIds.length ||
        regionIds.length > 40 ||
        !regionIds.every((id) => all.some((r) => r.id === id)))
    )
      throw new MarketError("라이더 활동 지역을 선택하세요.");
    if (
      storeId &&
      !(await one(pool, "SELECT id FROM market_stores WHERE id=$1", [storeId]))
    )
      throw new MarketError("등록된 업체를 선택하세요.");
    const id = uuid(),
      password = randomBytes(18).toString("base64url"),
      salt = randomBytes(16).toString("hex"),
      hash = scryptSync(password, salt, 64).toString("hex");
    await pool.query(
      "INSERT INTO market_accounts(id,username,name,role,password_hash,salt,store_id,region_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      [
        id,
        username,
        name,
        v.role,
        hash,
        salt,
        storeId,
        JSON.stringify(regionIds),
      ],
    );
    return {
      id,
      username,
      password,
      note: "접속 비밀번호는 이 응답에서만 표시합니다. 공개 페이지에 게시하지 마세요.",
    };
  }
  async function regionState(actor, id, active) {
    requireRole(actor, "operator");
    identifier(id);
    await pool.query("UPDATE market_regions SET active=$2 WHERE id=$1", [
      id,
      active === true,
    ]);
    return { ok: true };
  }
  async function accountState(actor, id, v) {
    requireRole(actor, "operator");
    identifier(id);
    const row = await one(pool, "SELECT * FROM market_accounts WHERE id=$1", [
      id,
    ]);
    if (!row) throw new MarketError("계정을 찾을 수 없습니다.", 404);
    return transaction(async (c) => {
      let password;
      if (v.resetPassword === true) {
        password = randomBytes(18).toString("base64url");
        const salt = randomBytes(16).toString("hex");
        await c.query(
          "UPDATE market_accounts SET password_hash=$2,salt=$3 WHERE id=$1",
          [id, scryptSync(password, salt, 64).toString("hex"), salt],
        );
      } else
        await c.query(
          "UPDATE market_accounts SET active=$2,on_duty=false WHERE id=$1",
          [id, v.active === true],
        );
      await c.query("DELETE FROM market_sessions WHERE actor_id=$1", [id]);
      return password ? { id, username: row.username, password } : { ok: true };
    });
  }
  async function availability(actor, open) {
    requireRole(actor, "merchant");
    const s = await one(
      pool,
      "SELECT * FROM market_stores WHERE id=$1 AND status='active'",
      [actor.storeId],
    );
    if (!s)
      throw new MarketError(
        "승인된 업체만 영업 상태를 변경할 수 있습니다.",
        409,
      );
    await pool.query("UPDATE market_stores SET open=$2 WHERE id=$1", [
      s.id,
      open === true,
    ]);
    return { ok: true };
  }
  async function addProduct(actor, v) {
    requireRole(actor, "operator", "merchant");
    const storeId =
      actor.role === "merchant" ? actor.storeId : identifier(v.storeId);
    if (
      !validLeaf(v.category, v.subcategory ?? "") ||
      !categories.includes(v.category) ||
      !["ambient", "chilled", "frozen"].includes(v.storage)
    )
      throw new MarketError("상품 분류·보관 방식을 확인하세요.");
    return transaction(async (c) => {
      if (
        !(await one(c, "SELECT id FROM market_stores WHERE id=$1 FOR UPDATE", [
          storeId,
        ]))
      )
        throw new MarketError("업체를 찾을 수 없습니다.", 404);
      const n = await one(
        c,
        "SELECT count(*) AS n FROM market_products WHERE store_id=$1 AND deleted=false",
        [storeId],
      );
      if (Number(n.n) >= 50)
        throw new MarketError("업체별 상품 등록 한도는 50개입니다.", 409);
      const id = uuid();
      await c.query(
        "INSERT INTO market_products(id,store_id,title,category,unit,price,stock,active,description,origin,storage,subcategory) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          id,
          storeId,
          text(v.title, 80),
          v.category,
          text(v.unit, 40),
          integer(v.price, 1, 100000000),
          integer(v.stock, 0, 100000),
          v.active === true,
          optional(v.description, 2000),
          text(v.origin, 200),
          v.storage,
          v.subcategory ?? "",
        ],
      );
      return { id };
    });
  }
  async function updateProduct(actor, id, v) {
    requireRole(actor, "operator", "merchant");
    identifier(id);
    return transaction(async (c) => {
      const p = await one(
        c,
        "SELECT * FROM market_products WHERE id=$1 AND deleted=false FOR UPDATE",
        [id],
      );
      if (!p || (actor.role === "merchant" && p.store_id !== actor.storeId))
        throw new MarketError("상품 접근 권한을 확인하세요.", 403);
      const price = integer(v.price, 1, 100000000),
        stock = integer(v.stock, 0, 100000);
      if (typeof v.active !== "boolean")
        throw new MarketError("공개 상태를 확인하세요.");
      await c.query(
        "UPDATE market_products SET price=$2,stock=$3,active=$4 WHERE id=$1",
        [id, price, stock, v.active],
      );
      return { ok: true };
    });
  }
  async function removeProduct(actor, id) {
    requireRole(actor, "operator", "merchant");
    identifier(id);
    return transaction(async (c) => {
      const p = await one(
        c,
        "SELECT * FROM market_products WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!p || (actor.role === "merchant" && p.store_id !== actor.storeId))
        throw new MarketError("상품 접근 권한을 확인하세요.", 403);
      await c.query(
        "UPDATE market_products SET deleted=true,active=false WHERE id=$1",
        [id],
      );
      return { ok: true };
    });
  }
  async function addressCheck(actor, v) {
    requireRole(actor, "customer");
    if (v.consent !== true)
      throw new MarketError(
        "배송 주소 확인을 위한 정보 이용 동의가 필요합니다.",
      );
    if (!live())
      throw new MarketError("주소 확인·운영 정책 연결 전입니다.", 503);
    const all = await regions(),
      r = all.find((x) => x.id === identifier(v.regionId) && x.active),
      s = await one(
        pool,
        "SELECT * FROM market_stores WHERE id=$1 AND status='active' AND open=true",
        [identifier(v.storeId)],
      );
    if (!r || !s || !serves(s, r, all))
      throw new MarketError("이 업체의 배송 지역이 아닙니다.", 409);
    const base = text(v.addressBase, 200),
      response = await fetcher(
        "https://dapi.kakao.com/v2/local/search/address.json?query=" +
          encodeURIComponent(base),
        {
          headers: { Authorization: "KakaoAK " + env("KAKAO_REST_API_KEY") },
          signal: AbortSignal.timeout(8000),
        },
      );
    if (!response.ok)
      throw new MarketError("주소 확인 서비스 연결에 실패했습니다.", 502);
    const body = await response.json(),
      matches = (body.documents || []).filter(
        (d) =>
          d.address &&
          (regionMatches(r, placeFromKakao(d.address)) ||
            regionMatches(r, {
              ...placeFromKakao(d.address),
              dong: d.address.region_3depth_name || "",
            })),
      );
    if (matches.length !== 1)
      throw new MarketError(
        "선택한 배송 지역의 정확한 도로명/지번 주소를 입력하세요.",
      );
    const d = matches[0],
      id = uuid();
    await pool.query(
      "INSERT INTO market_address_checks(id,customer_id,store_id,region_id,address_base,verified_area,expires_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,now()+interval '15 minutes')",
      [
        id,
        actor.id,
        s.id,
        r.id,
        d.address_name,
        JSON.stringify(placeFromKakao(d.address)),
      ],
    );
    return { id, addressBase: d.address_name, regionId: r.id };
  }
  async function event(c, id, actor, action, note = "") {
    await c.query(
      "INSERT INTO market_events(id,order_id,actor_id,action,note) VALUES($1,$2,$3,$4,$5)",
      [uuid(), id, actor.id, action, note],
    );
  }
  async function createOrder(actor, input) {
    requireRole(actor, "customer");
    if (!live())
      throw new MarketError(
        "실제 주문 서비스가 아직 활성화되지 않았습니다.",
        503,
      );
    const v = orderInput(input);
    return transaction(async (c) => {
      if (
        !(await one(
          c,
          "SELECT id FROM market_customers WHERE id=$1 FOR UPDATE",
          [actor.id],
        ))
      )
        throw new MarketError("구매자 세션을 다시 연결하세요.", 401);
      const old = await one(
        c,
        "SELECT * FROM market_orders WHERE customer_id=$1 AND idempotency_key=$2",
        [actor.id, v.idempotencyKey],
      );
      const verified = await one(
        c,
        "SELECT * FROM market_address_checks WHERE id=$1 AND customer_id=$2 AND store_id=$3 AND region_id=$4",
        [v.addressCheckId, actor.id, v.storeId, v.regionId],
      );
      if (!verified) throw new MarketError("배송 주소를 다시 확인하세요.", 409);
      const hash = digest(
        JSON.stringify({
          ...v,
          addressCheckId: undefined,
          addressBase: verified.address_base,
        }),
      );
      if (old) {
        if (old.request_hash !== hash)
          throw new MarketError(
            "같은 주문 키로 다른 내용을 보낼 수 없습니다.",
            409,
          );
        return safeOrder(old, actor);
      }
      const count = await one(
        c,
        "SELECT count(*) AS n FROM market_orders WHERE customer_id=$1 AND status='new'",
        [actor.id],
      );
      if (Number(count.n) >= 5)
        throw new MarketError(
          "진행 중인 접수 대기 주문을 먼저 확인하세요.",
          409,
        );
      const all = (await c.query("SELECT * FROM market_regions FOR SHARE"))
          .rows,
        r = all.find((x) => x.id === v.regionId && x.active),
        s = await one(c, "SELECT * FROM market_stores WHERE id=$1 FOR UPDATE", [
          v.storeId,
        ]);
      if (!r || !s || s.status !== "active" || !s.open || !serves(s, r, all))
        throw new MarketError(
          "업체 또는 배송 지역이 현재 주문 가능하지 않습니다.",
          409,
        );
      const address = await one(
        c,
        "SELECT * FROM market_address_checks WHERE id=$1 AND customer_id=$2 AND store_id=$3 AND region_id=$4 AND expires_at>now() FOR UPDATE",
        [v.addressCheckId, actor.id, s.id, r.id],
      );
      if (!address) throw new MarketError("배송 주소를 다시 확인하세요.", 409);
      const rows = (
        await c.query(
          `SELECT * FROM market_products WHERE id IN (${v.items.map((_, i) => "$" + (i + 1)).join(",")}) ORDER BY id FOR UPDATE`,
          v.items.map((x) => x.productId),
        )
      ).rows;
      let subtotal = 0;
      const items = v.items.map((line) => {
        const p = rows.find((x) => x.id === line.productId);
        if (
          !p ||
          p.store_id !== s.id ||
          !p.active ||
          p.deleted ||
          p.stock < line.quantity
        )
          throw new MarketError(
            "상품 또는 판매가능 재고를 다시 확인하세요.",
            409,
          );
        subtotal += p.price * line.quantity;
        return {
          productId: p.id,
          title: p.title,
          unit: p.unit,
          price: p.price,
          quantity: line.quantity,
        };
      });
      if (subtotal + s.delivery_fee !== v.expectedTotal)
        throw new MarketError(
          "상품금액 또는 배송비가 변경됐습니다. 장바구니를 다시 확인하세요.",
          409,
        );
      if (!Number.isSafeInteger(subtotal) || subtotal < s.minimum_order)
        throw new MarketError("최소 주문금액을 확인하세요.");
      for (const item of items)
        await c.query("UPDATE market_products SET stock=stock-$2 WHERE id=$1", [
          item.productId,
          item.quantity,
        ]);
      const id = uuid(),
        code = String(randomInt(1000, 10000));
      await c.query(
        "INSERT INTO market_orders(id,customer_id,store_id,region_id,status,items,customer_name,phone,address_base,address_detail,subtotal,delivery_fee,total,idempotency_key,request_hash,delivery_code) VALUES($1,$2,$3,$4,'new',$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        [
          id,
          actor.id,
          s.id,
          r.id,
          JSON.stringify(items),
          v.customerName,
          v.phone,
          address.address_base,
          v.addressDetail,
          subtotal,
          s.delivery_fee,
          subtotal + s.delivery_fee,
          v.idempotencyKey,
          hash,
          code,
        ],
      );
      await event(c, id, actor, "created");
      return safeOrder(
        await one(c, "SELECT * FROM market_orders WHERE id=$1", [id]),
        actor,
      );
    });
  }
  async function orders(actor) {
    requireRole(actor, "customer", "merchant", "rider", "operator");
    let sql = "SELECT * FROM market_orders",
      p = [];
    if (actor.role === "customer") {
      sql += " WHERE customer_id=$1";
      p = [actor.id];
    }
    if (actor.role === "merchant") {
      sql += " WHERE store_id=$1";
      p = [actor.storeId];
    }
    if (actor.role === "rider") {
      sql += " WHERE rider_id=$1 OR (status='ready' AND rider_id IS NULL)";
      p = [actor.id];
    }
    const all = await regions(),
      accountRow =
        actor.role === "rider"
          ? await one(
              pool,
              "SELECT * FROM market_accounts WHERE id=$1 AND active=true",
              [actor.id],
            )
          : null;
    return (
      await pool.query(sql + " ORDER BY created_at DESC LIMIT 100", p)
    ).rows
      .filter(
        (o) =>
          actor.role !== "rider" ||
          o.rider_id === actor.id ||
          (accountRow?.on_duty &&
            riderServes(
              accountRow,
              all.find((r) => r.id === o.region_id) || {},
              all,
            )),
      )
      .map((o) => safeOrder(o, actor));
  }
  async function action(actor, id, v) {
    requireRole(actor, "customer", "merchant", "rider", "operator");
    identifier(id);
    integer(v.version, 1, 2147483647);
    return transaction(async (c) => {
      let o = await one(
        c,
        "SELECT * FROM market_orders WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!o) throw new MarketError("주문을 찾을 수 없습니다.", 404);
      if (o.version !== v.version)
        throw new MarketError(
          "다른 화면에서 주문이 변경됐습니다. 새로고침하세요.",
          409,
        );
      const isOp = actor.role === "operator",
        isMerchant = actor.role === "merchant" && actor.storeId === o.store_id,
        isCustomer = actor.role === "customer" && actor.id === o.customer_id,
        isRider = actor.role === "rider" && actor.id === o.rider_id;
      const a = v.action;
      if (!(
        isOp ||
        isMerchant ||
        isCustomer ||
        (actor.role === "rider" && ["claim"].includes(a)) ||
        isRider
      ))
        throw new MarketError("이 주문에 접근할 권한이 없습니다.", 403);
      if (a === "accept" && !(isOp || isMerchant))
        throw new MarketError("해당 업체 권한이 필요합니다.", 403);
      if (
        a === "accept" &&
        o.status === "new" &&
        new Date(o.expires_at).getTime() <= Date.now()
      ) {
        for (const line of o.items)
          await c.query(
            "UPDATE market_products SET stock=stock+$2 WHERE id=$1",
            [line.productId, line.quantity],
          );
        await c.query(
          "UPDATE market_orders SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1",
          [id],
        );
        await event(
          c,
          id,
          { id: "system" },
          "expired",
          "접수 만료 후 승인 차단",
        );
        return {
          error: "접수 대기 시간이 만료되어 자동 취소했습니다.",
          status: 409,
        };
      }
      let next = o.status,
        note = optional(v.note, 500);
      if (["accept", "prepare", "ready", "reject"].includes(a)) {
        if (!isOp && !isMerchant)
          throw new MarketError("해당 업체 권한이 필요합니다.", 403);
        const pairs = {
          accept: ["new", "accepted"],
          prepare: ["accepted", "preparing"],
          ready: ["preparing", "ready"],
          reject: ["new", "rejected"],
        }[a];
        if (o.status !== pairs[0])
          throw new MarketError("현재 주문 단계에서 처리할 수 없습니다.", 409);
        next = pairs[1];
        if (a === "reject" && !note)
          throw new MarketError("거절 사유를 입력하세요.");
      } else if (a === "cancel") {
        if (!(isOp || isMerchant || (isCustomer && o.status === "new")))
          throw new MarketError("취소 권한을 확인하세요.", 403);
        if (terminal.includes(o.status) || o.status === "picked_up")
          throw new MarketError(
            "이 단계에서는 주문을 취소할 수 없습니다.",
            409,
          );
        if (!note) throw new MarketError("취소 사유를 입력하세요.");
        next = "cancelled";
      } else if (a === "claim" || a === "assign" || a === "reassign") {
        if (!(
          (actor.role === "rider" && a === "claim") ||
          (isOp && ["assign", "reassign"].includes(a))
        ))
          throw new MarketError("배차 권한이 필요합니다.", 403);
        if (a === "reassign") {
          if (
            !["ready", "picked_up"].includes(o.status) ||
            !o.rider_id ||
            !note
          )
            throw new MarketError(
              "재배차 대상과 실제 인계 사유를 확인하세요.",
              409,
            );
        } else if (o.status !== "ready" || o.rider_id)
          throw new MarketError(
            "다른 라이더가 수락했거나 픽업 준비 전입니다.",
            409,
          );
        const rid = actor.role === "rider" ? actor.id : identifier(v.riderId),
          r = await one(
            c,
            "SELECT * FROM market_accounts WHERE id=$1 AND active=true AND role='rider' FOR UPDATE",
            [rid],
          ),
          all = await regions();
        if (
          !r ||
          !r.on_duty ||
          !riderServes(r, all.find((x) => x.id === o.region_id) || {}, all)
        )
          throw new MarketError("활동 지역·근무 상태를 확인하세요.", 403);
        const active = await one(
          c,
          "SELECT count(*) AS n FROM market_orders WHERE rider_id=$1 AND id<>$2 AND status NOT IN ('cancelled','rejected','delivered')",
          [rid, o.id],
        );
        if (Number(active.n))
          throw new MarketError("현재 배송 중인 주문을 먼저 완료하세요.", 409);
        await c.query("UPDATE market_orders SET rider_id=$2 WHERE id=$1", [
          o.id,
          rid,
        ]);
      } else if (a === "pickup") {
        if (!isRider || o.status !== "ready")
          throw new MarketError(
            "배정된 라이더의 픽업 준비 주문만 처리할 수 있습니다.",
            403,
          );
        next = "picked_up";
      } else if (a === "deliver") {
        if (!isRider || o.status !== "picked_up")
          throw new MarketError(
            "배정된 라이더의 배송 중 주문만 완료할 수 있습니다.",
            403,
          );
        if (o.delivery_attempts >= 5)
          throw new MarketError(
            "인계 확인번호 시도 한도입니다. 운영자에게 확인하세요.",
            409,
          );
        const code = String(v.deliveryCode || "");
        if (
          !/^\d{4}$/.test(code) ||
          !timingSafeEqual(Buffer.from(code), Buffer.from(o.delivery_code))
        ) {
          await c.query(
            "UPDATE market_orders SET delivery_attempts=delivery_attempts+1,version=version+1 WHERE id=$1",
            [id],
          );
          await event(c, id, actor, "invalid_delivery_code");
          return { error: "인계 확인번호가 일치하지 않습니다.", status: 409 };
        }
        next = "delivered";
      } else if (a === "incident") {
        if (!isRider || terminal.includes(o.status) || !note)
          throw new MarketError("배송 문제 내용을 입력하세요.", 403);
      } else if (a === "reset_delivery_attempts") {
        if (!isOp || !note)
          throw new MarketError("운영자 확인 사유가 필요합니다.", 403);
        await c.query(
          "UPDATE market_orders SET delivery_attempts=0 WHERE id=$1",
          [id],
        );
      } else throw new MarketError("지원하지 않는 주문 동작입니다.");
      if (
        ["cancelled", "rejected"].includes(next) &&
        !terminal.includes(o.status)
      )
        for (const line of o.items)
          await c.query(
            "UPDATE market_products SET stock=stock+$2 WHERE id=$1",
            [line.productId, line.quantity],
          );
      await c.query(
        "UPDATE market_orders SET status=$2,version=version+1,updated_at=now() WHERE id=$1",
        [id, next],
      );
      await event(c, id, actor, a, note);
      o = await one(c, "SELECT * FROM market_orders WHERE id=$1", [id]);
      return safeOrder(o, actor);
    });
  }
  async function duty(actor, onDuty) {
    requireRole(actor, "rider");
    await pool.query(
      "UPDATE market_accounts SET on_duty=$2 WHERE id=$1 AND active=true",
      [actor.id, onDuty === true],
    );
    return { ok: true };
  }
  async function adminData(actor) {
    requireRole(actor, "operator", "merchant", "rider");
    const stores =
      actor.role === "operator"
        ? (await pool.query("SELECT * FROM market_stores ORDER BY name")).rows
        : actor.role === "merchant"
          ? (
              await pool.query("SELECT * FROM market_stores WHERE id=$1", [
                actor.storeId,
              ])
            ).rows
          : [];
    const accounts =
      actor.role === "operator"
        ? (
            await pool.query(
              "SELECT id,username,name,role,store_id,region_ids,active,on_duty FROM market_accounts ORDER BY name",
            )
          ).rows
        : [];
    const capacity = await one(
      pool,
      "SELECT vendor_count FROM market_capacity WHERE id=1",
    );
    return {
      regions: await regions(),
      stores,
      accounts,
      vendorCount: capacity.vendor_count,
      vendorLimit: 100,
      productLimit: 50,
    };
  }
  async function expire() {
    return transaction(async (c) => {
      const rows = (
        await c.query(
          "SELECT * FROM market_orders WHERE status='new' AND expires_at<now() FOR UPDATE",
        )
      ).rows;
      for (const o of rows) {
        for (const line of o.items)
          await c.query(
            "UPDATE market_products SET stock=stock+$2 WHERE id=$1",
            [line.productId, line.quantity],
          );
        await c.query(
          "UPDATE market_orders SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1",
          [o.id],
        );
        await event(
          c,
          o.id,
          { id: "system" },
          "expired",
          "15분 접수 대기 만료",
        );
      }
      await c.query("DELETE FROM market_sessions WHERE expires_at<now()");
      await c.query("DELETE FROM market_address_checks WHERE expires_at<now()");
      await c.query("DELETE FROM market_rate_limits WHERE expires_at<now()");
      return { expired: rows.length };
    });
  }
  return {
    config,
    regions,
    resolveLocation,
    publicStores,
    catalog,
    products,
    createRegion,
    createStore,
    storeState,
    regionState,
    account,
    accountState,
    availability,
    addProduct,
    updateProduct,
    removeProduct,
    guest,
    login,
    logout,
    session,
    rate,
    addressCheck,
    createOrder,
    orders,
    action,
    duty,
    adminData,
    expire,
  };
}
