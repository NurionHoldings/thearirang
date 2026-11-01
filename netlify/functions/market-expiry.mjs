import { getDatabase } from "@netlify/database";
import { makeMarketService } from "./_market/service.mjs";
export default async () =>
  Response.json(await makeMarketService(getDatabase().pool).expire());
export const config = { schedule: "*/5 * * * *" };
