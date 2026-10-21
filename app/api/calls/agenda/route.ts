import { connection } from "next/server";
import tzlookup from "tz-lookup";
import { json } from "@/lib/api";
import { callbackAgenda } from "@/lib/calls";

// Today's to-do: overdue callbacks and the ones due today (?tz= the caller's time zone).
export async function GET(req: Request) {
  await connection();
  const tz = new URL(req.url).searchParams.get("tz") || "UTC";
  const { items, tomorrow, counts } = await callbackAgenda(tz);
  return json({
    tomorrow,
    counts,
    items: items.map(({ lat, lng, ...r }) => {
      let leadTz: string | null = null;
      try {
        leadTz = lat != null && lng != null ? tzlookup(lat, lng) : null;
      } catch {}
      return { ...r, tz: leadTz };
    }),
  });
}
