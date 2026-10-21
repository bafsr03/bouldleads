import { connection } from "next/server";
import { json } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { heatmapData } from "@/lib/heatmap";

export async function GET() {
  await connection();
  return json(await heatmapData((await getSettings()).timezone));
}
