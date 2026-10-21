import { connection } from "next/server";
import tzlookup from "tz-lookup";
import { json } from "@/lib/api";
import { callbackSchedule } from "@/lib/calls";

// All scheduled callbacks, earliest first (?tz= the caller's time zone, for grouping by day).
export async function GET(req: Request) {
  await connection();
  const tz = new URL(req.url).searchParams.get("tz") || "UTC";
  const rows = await callbackSchedule(tz);
  return json(
    rows.map(({ lat, lng, ...r }) => {
      let leadTz: string | null = null;
      try {
        leadTz = lat != null && lng != null ? tzlookup(lat, lng) : null;
      } catch {}
      return { ...r, tz: leadTz };
    }),
  );
}
