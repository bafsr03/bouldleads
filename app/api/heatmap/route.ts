import { connection } from "next/server";
import { json } from "@/lib/api";
import { memo } from "@/lib/memo";
import { getSettings } from "@/lib/settings";
import { heatmapData } from "@/lib/heatmap";

export async function GET() {
  await connection();
  return json(await memo("heatmap", 30_000, async () => heatmapData((await getSettings()).timezone)));
}
