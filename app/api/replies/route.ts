import { connection } from "next/server";
import { db } from "@/lib/db";
import { json } from "@/lib/api";

export async function GET() {
  await connection();
  return json(
    await db.all(
      `SELECT r.*, b.id AS business_id, b.name, b.website, b.phone, c.name AS campaign, c.kind AS campaign_kind FROM replies r
       JOIN campaign_leads cl ON cl.id = r.campaign_lead_id
       JOIN businesses b ON b.id = cl.business_id
       JOIN campaigns c ON c.id = cl.campaign_id
       ORDER BY r.received_at DESC LIMIT 200`,
    ),
  );
}
