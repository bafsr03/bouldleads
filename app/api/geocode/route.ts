import { geocode } from "@/lib/discovery/nominatim";
import { bad, json } from "@/lib/api";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return bad("Missing q");
  try {
    return json(await geocode(q));
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Geocoding failed", 502);
  }
}
