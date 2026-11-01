import { getUser } from "@netlify/identity";
import { identityCustomer, makeMemberService } from "./_market/member.mjs";
import { getDatabase } from "@netlify/database";
import { makeMarketService } from "./_market/service.mjs";
import { MarketError } from "./_market/domain.mjs";
const cookieValue = (req, name) =>
  req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1) || "";
const staffCookie = "__Host-arirang_market",
  customerCookie = "__Host-arirang_customer";
const cookie = (name, token, age = 86400) =>
  `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
export function marketHandler(
  serviceFactory,
  env = (key) => Netlify.env.get(key),
  identity = getUser,
) {
  return async (req, context = {}) => {
    try {
      const url = new URL(req.url),
        path = url.pathname.replace(/^\/market-api/, "") || "/",
        method = req.method;
      if (!["GET", "POST", "PATCH", "DELETE"].includes(method))
        return json({ error: "지원하지 않는 요청 방식입니다." }, 405);
      if (method !== "GET" && req.headers.get("origin") !== url.origin)
        throw new MarketError("요청 출처를 확인하세요.", 403);
      const service = serviceFactory(),
        staffToken = cookieValue(req, staffCookie),
        customerToken = cookieValue(req, customerCookie);
      let body = {};
      if (method !== "GET") {
        const raw = await req.text();
        if (raw.length > 16384)
          throw new MarketError("요청 내용이 너무 큽니다.", 413);
        if (raw) {
          if (!req.headers.get("content-type")?.startsWith("application/json"))
            throw new MarketError("JSON 요청이 필요합니다.", 415);
          try {
            body = JSON.parse(raw);
          } catch {
            throw new MarketError("요청 형식을 확인하세요.");
          }
          if (!body || typeof body !== "object" || Array.isArray(body))
            throw new MarketError("요청 형식을 확인하세요.");
        }
      }
      if (path === "/config" && method === "GET")
        return json(await service.config());
      if (path === "/regions" && method === "GET")
        return json((await service.regions()).filter((r) => r.active));
      if (path === "/location" && method === "POST")
        return json(await service.resolveLocation(body, context.geo || {}));
      if (path === "/stores" && method === "GET")
        return json(await service.publicStores(url.searchParams.get("region")));
      if (path === "/catalog" && method === "GET")
        return json(await service.catalog(url.searchParams.get("region")));
      const staff = await service.session(staffToken),
        guest = await service.session(customerToken),
        signedMember = identityCustomer(await identity()),
        customer = signedMember || guest;
      if (path === "/member/me" && method === "GET")
        return json(await service.members.me(signedMember));
      if (path === "/member/session" && method === "POST")
        return json(await service.members.sync(signedMember));
      if (path === "/member/addresses" && method === "POST")
        return json(await service.members.save(signedMember, body), 201);
      const addressRoute =
        /^\/member\/addresses\/([a-f0-9-]+)(?:\/(select|default))?$/.exec(path);
      if (addressRoute) {
        const [, id, action] = addressRoute;
        if (action && method === "POST")
          return json(
            await service.members.select(
              signedMember,
              id,
              action === "default",
            ),
          );
        if (!action && method === "PATCH")
          return json(await service.members.save(signedMember, body, id));
        if (!action && method === "DELETE")
          return json(
            await service.members.remove(signedMember, id, body.version),
          );
      }
      if (path === "/member/address-check" && method === "POST") {
        const a = await service.members.orderAddress(
          signedMember,
          body.addressId,
        );
        return json(
          await service.addressCheck(signedMember, {
            storeId: body.storeId,
            regionId: a.region_id,
            addressBase: a.address_base,
            consent: body.consent,
          }),
        );
      }
      if (path === "/session" && method === "GET")
        return json({ staff, customer });
      if (path === "/customer-session" && method === "POST") {
        if (customer?.role === "customer") return json({ actor: customer });
        const data = await service.guest(context.ip || "unknown");
        return json({ actor: data.actor }, 200, {
          "Set-Cookie": cookie(customerCookie, data.token),
        });
      }
      if (path === "/login" && method === "POST") {
        const data = await service.login(body, context.ip || "unknown");
        return json({ actor: data.actor }, 200, {
          "Set-Cookie": cookie(staffCookie, data.token),
        });
      }
      if (path === "/logout" && method === "POST") {
        await service.logout(staffToken);
        return json({ ok: true }, 200, {
          "Set-Cookie": cookie(staffCookie, "", 0),
        });
      }
      if (path === "/products" && method === "GET")
        return json(
          await service.products(url.searchParams.get("storeId"), staff),
        );
      if (path === "/address-check" && method === "POST")
        return json(await service.addressCheck(customer, body));
      if (path === "/orders" && method === "POST")
        return json(await service.createOrder(customer, body), 201);
      if (path === "/orders" && method === "GET")
        return json(
          await service.orders(
            url.searchParams.get("workspace") === "staff" ? staff : customer,
          ),
        );
      const action = /^\/orders\/([a-f0-9-]+)\/action$/.exec(path);
      if (action && method === "POST") {
        const a =
          body.action === "cancel" && body.workspace !== "staff"
            ? customer
            : staff;
        const result = await service.action(a, action[1], body);
        return json(result, result.error ? result.status : 200);
      }
      if (path === "/operations" && method === "GET")
        return json(await service.adminData(staff));
      const region = /^\/regions\/([a-f0-9-]+)$/.exec(path);
      if (region && method === "PATCH")
        return json(await service.regionState(staff, region[1], body.active));
      if (path === "/regions" && method === "POST")
        return json(await service.createRegion(staff, body), 201);
      if (path === "/stores" && method === "POST")
        return json(await service.createStore(staff, body), 201);
      const store = /^\/stores\/([a-f0-9-]+)$/.exec(path);
      if (store && method === "PATCH")
        return json(await service.storeState(staff, store[1], body));
      const account = /^\/accounts\/([a-f0-9-]+)$/.exec(path);
      if (account && method === "PATCH")
        return json(await service.accountState(staff, account[1], body));
      if (path === "/availability" && method === "POST")
        return json(await service.availability(staff, body.open));
      if (path === "/accounts" && method === "POST")
        return json(await service.account(staff, body), 201);
      if (path === "/products" && method === "POST")
        return json(await service.addProduct(staff, body), 201);
      const product = /^\/products\/([a-f0-9-]+)$/.exec(path);
      if (product && method === "PATCH")
        return json(await service.updateProduct(staff, product[1], body));
      if (product && method === "DELETE")
        return json(await service.removeProduct(staff, product[1]));
      if (path === "/duty" && method === "POST")
        return json(await service.duty(staff, body.onDuty));
      return json({ error: "요청한 기능을 찾을 수 없습니다." }, 404);
    } catch (error) {
      if (error instanceof MarketError)
        return json({ error: error.message }, error.status);
      if (error?.code === "23505")
        return json(
          { error: "같은 업체 계정 또는 요청이 이미 등록됐습니다." },
          409,
        );
      console.error("market-api", error?.code || error?.name || "unavailable");
      return json(
        {
          error:
            "주문 서비스 저장소 연결을 확인하고 잠시 후 다시 시도해 주세요.",
        },
        503,
      );
    }
  };
}
let service;
export default marketHandler(() => {
  if (!service) {
    const pool = getDatabase().pool,
      options = { env: (key) => Netlify.env.get(key) };
    service = {
      ...makeMarketService(pool, options),
      members: makeMemberService(pool, options),
    };
  }
  return service;
});
export const config = {
  path: ["/market-api", "/market-api/*"],
  rateLimit: {
    windowLimit: 180,
    windowSize: 60,
    aggregateBy: "ip",
    action: "rate_limit",
  },
};
