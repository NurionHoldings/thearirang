import {
  MarketError,
  uuid,
  text,
  optional,
  identifier,
  bestRegion,
  placeFromKakao,
} from "./domain.mjs";
export function identityCustomer(user) {
  if (!user?.id) return null;
  return {
    id: "member:" + identifier(user.id),
    role: "customer",
    member: true,
    name: String(user.name || ""),
    email: String(user.email || ""),
  };
}
export function makeMemberService(
  pool,
  { env = () => undefined, fetcher = fetch } = {},
) {
  const query = (c, q, p = []) => c.query(q, p),
    one = async (c, q, p = []) => (await query(c, q, p)).rows[0];
  const member = (a) => {
    if (!a?.member || a.role !== "customer" || !a.id.startsWith("member:"))
      throw new MarketError("회원 로그인 후 이용하세요.", 401);
  };
  const tx = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  };
  async function sync(a) {
    member(a);
    await pool.query(
      "INSERT INTO market_customers(id) VALUES($1) ON CONFLICT(id) DO NOTHING",
      [a.id],
    );
    return me(a);
  }
  async function me(a) {
    if (!a) return { member: null, addresses: [], selectedAddressId: null };
    member(a);
    const profile = await one(
      pool,
      "SELECT selected_address_id FROM market_customers WHERE id=$1",
      [a.id],
    );
    const addresses = (
      await pool.query(
        "SELECT * FROM market_member_addresses WHERE customer_id=$1 ORDER BY is_default DESC,created_at",
        [a.id],
      )
    ).rows;
    return {
      member: { id: a.id, name: a.name, email: a.email },
      selectedAddressId:
        profile?.selected_address_id ||
        addresses.find((v) => v.is_default)?.id ||
        null,
      addresses,
    };
  }
  async function resolve(base) {
    const key = env("KAKAO_REST_API_KEY");
    if (!key)
      return {
        address_base: base,
        postal_code: "",
        verified_area: null,
        region_id: null,
        verified_at: null,
      };
    const r = await fetcher(
      "https://dapi.kakao.com/v2/local/search/address.json?query=" +
        encodeURIComponent(base),
      {
        headers: { Authorization: "KakaoAK " + key },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!r.ok)
      throw new MarketError(
        "주소 확인 서비스 연결에 실패했습니다. 잠시 후 다시 저장하세요.",
        502,
      );
    const d = await r.json();
    if (
      !Array.isArray(d.documents) ||
      d.documents.length !== 1 ||
      !d.documents[0].address
    )
      throw new MarketError("정확한 도로명 또는 지번 주소를 입력하세요.");
    const row = d.documents[0],
      place = placeFromKakao(row.address),
      areas = (
        await pool.query("SELECT * FROM market_regions WHERE active=true")
      ).rows;
    return {
      address_base: String(row.road_address?.address_name || row.address_name),
      postal_code: String(row.road_address?.zone_no || ""),
      verified_area: place,
      region_id: bestRegion(areas, place)?.id || null,
      verified_at: new Date().toISOString(),
    };
  }
  function fields(v) {
    const phone = text(v.phone, 20).replace(/[-\s]/g, "");
    if (!/^01[016789]\d{7,8}$/.test(phone))
      throw new MarketError("받는 분의 휴대전화 번호를 확인하세요.");
    const postal_code = optional(v.postalCode, 5);
    if (postal_code && !/^\d{5}$/.test(postal_code))
      throw new MarketError("우편번호는 5자리로 입력하세요.");
    return {
      label: text(v.label, 30),
      recipient_name: text(v.recipientName, 40),
      phone,
      address_base: text(v.addressBase, 200),
      address_detail: text(v.addressDetail, 200),
      postal_code,
      delivery_note: optional(v.deliveryNote, 300),
    };
  }
  async function save(a, v, id) {
    member(a);
    if (v.consent !== true)
      throw new MarketError("배송지 저장을 위한 정보 이용에 동의해 주세요.");
    if (id) identifier(id);
    const f = fields(v);
    const prior = id
      ? await one(
          pool,
          "SELECT * FROM market_member_addresses WHERE id=$1 AND customer_id=$2",
          [id, a.id],
        )
      : null;
    if (id && !prior) throw new MarketError("배송지를 찾을 수 없습니다.", 404);
    const verified =
      prior?.verified_at && prior?.address_base === f.address_base
        ? {
            address_base: prior.address_base,
            postal_code: prior.postal_code,
            verified_area: prior.verified_area,
            region_id: prior.region_id,
            verified_at: prior.verified_at,
          }
        : await resolve(f.address_base);
    return tx(async (c) => {
      await c.query(
        "INSERT INTO market_customers(id) VALUES($1) ON CONFLICT(id) DO NOTHING",
        [a.id],
      );
      await one(c, "SELECT id FROM market_customers WHERE id=$1 FOR UPDATE", [
        a.id,
      ]);
      const all = (
        await c.query(
          "SELECT * FROM market_member_addresses WHERE customer_id=$1 ORDER BY created_at",
          [a.id],
        )
      ).rows;
      const current = id ? all.find((x) => x.id === id) : null;
      if (id && (!current || current.version !== v.version))
        throw new MarketError(
          "배송지가 변경됐습니다. 다시 열어 확인하세요.",
          409,
        );
      if (!id && all.length >= 10)
        throw new MarketError(
          "배송지는 최대 10개까지 등록할 수 있습니다.",
          409,
        );
      const key = id || uuid(),
        isDefault =
          v.isDefault === true || !all.length || current?.is_default === true;
      if (isDefault)
        await c.query(
          "UPDATE market_member_addresses SET is_default=false WHERE customer_id=$1",
          [a.id],
        );
      const data = { ...f, ...verified };
      if (!data.verified_at) data.postal_code = f.postal_code;
      await c.query(
        `INSERT INTO market_member_addresses(id,customer_id,label,recipient_name,phone,address_base,address_detail,postal_code,delivery_note,verified_area,region_id,verified_at,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,recipient_name=EXCLUDED.recipient_name,phone=EXCLUDED.phone,address_base=EXCLUDED.address_base,address_detail=EXCLUDED.address_detail,postal_code=EXCLUDED.postal_code,delivery_note=EXCLUDED.delivery_note,verified_area=EXCLUDED.verified_area,region_id=EXCLUDED.region_id,verified_at=EXCLUDED.verified_at,is_default=EXCLUDED.is_default,version=market_member_addresses.version+1,updated_at=now()`,
        [
          key,
          a.id,
          data.label,
          data.recipient_name,
          data.phone,
          data.address_base,
          data.address_detail,
          data.postal_code,
          data.delivery_note,
          JSON.stringify(data.verified_area),
          data.region_id,
          data.verified_at,
          isDefault,
        ],
      );
      if (!all.length || isDefault)
        await c.query(
          "UPDATE market_customers SET selected_address_id=$2 WHERE id=$1",
          [a.id, key],
        );
      return {
        id: key,
        verified: !!data.verified_at,
        serviceable: !!data.region_id,
      };
    });
  }
  async function select(a, id, makeDefault = false) {
    member(a);
    identifier(id);
    return tx(async (c) => {
      await one(c, "SELECT id FROM market_customers WHERE id=$1 FOR UPDATE", [
        a.id,
      ]);
      const row = await one(
        c,
        "SELECT * FROM market_member_addresses WHERE id=$1 AND customer_id=$2",
        [id, a.id],
      );
      if (!row) throw new MarketError("배송지를 찾을 수 없습니다.", 404);
      if (makeDefault) {
        await c.query(
          "UPDATE market_member_addresses SET is_default=false WHERE customer_id=$1",
          [a.id],
        );
        await c.query(
          "UPDATE market_member_addresses SET is_default=true WHERE id=$1",
          [id],
        );
      }
      await c.query(
        "UPDATE market_customers SET selected_address_id=$2 WHERE id=$1",
        [a.id, id],
      );
      return { ok: true };
    });
  }
  async function remove(a, id, version) {
    member(a);
    identifier(id);
    return tx(async (c) => {
      await one(c, "SELECT id FROM market_customers WHERE id=$1 FOR UPDATE", [
        a.id,
      ]);
      const row = await one(
        c,
        "SELECT * FROM market_member_addresses WHERE id=$1 AND customer_id=$2",
        [id, a.id],
      );
      if (!row) throw new MarketError("배송지를 찾을 수 없습니다.", 404);
      if (row.version !== version)
        throw new MarketError("배송지가 변경됐습니다. 다시 확인하세요.", 409);
      await c.query("DELETE FROM market_member_addresses WHERE id=$1", [id]);
      const remaining = (
        await c.query(
          "SELECT * FROM market_member_addresses WHERE customer_id=$1 ORDER BY is_default DESC,created_at",
          [a.id],
        )
      ).rows;
      if (remaining.length) {
        if (row.is_default)
          await c.query(
            "UPDATE market_member_addresses SET is_default=true WHERE id=$1",
            [remaining[0].id],
          );
        await c.query(
          "UPDATE market_customers SET selected_address_id=COALESCE(selected_address_id,$2) WHERE id=$1",
          [a.id, remaining[0].id],
        );
      }
      return { ok: true };
    });
  }
  async function orderAddress(a, id) {
    member(a);
    identifier(id);
    const row = await one(
      pool,
      "SELECT * FROM market_member_addresses WHERE id=$1 AND customer_id=$2",
      [id, a.id],
    );
    if (!row) throw new MarketError("배송지를 찾을 수 없습니다.", 404);
    if (!row.verified_at || !row.region_id)
      throw new MarketError("주소 확인 또는 배송지역 연결이 필요합니다.", 409);
    return row;
  }
  return { sync, me, save, select, remove, orderAddress };
}
