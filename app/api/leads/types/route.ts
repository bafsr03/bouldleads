import { connection } from "next/server";
import { db } from "@/lib/db";
import { json } from "@/lib/api";

// Business types present in the database, for filters.
export async function GET() {
  await connection();
  return json(
    await db.all(
      `SELECT category AS type, COUNT(*) AS total, SUM(status = 'verified') AS verified
       FROM businesses WHERE category IS NOT NULL GROUP BY category ORDER BY total DESC`,
    ),
  );
}
