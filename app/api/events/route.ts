import { connection } from "next/server";
import { db } from "@/lib/db";
import { json } from "@/lib/api";

export async function GET() {
  await connection();
  return json(await db.all("SELECT * FROM events WHERE message != 'Worker started' ORDER BY id DESC LIMIT 100"));
}
