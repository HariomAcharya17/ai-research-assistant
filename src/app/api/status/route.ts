import { connection } from "next/server";
import { sourceStatus } from "@/lib/server/sources";

export async function GET() {
  await connection();
  return Response.json(sourceStatus());
}
