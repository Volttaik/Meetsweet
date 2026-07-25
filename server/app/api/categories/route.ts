import { NextRequest } from "next/server";
import { ok } from "@/lib/api/response";

// Mobile app calls /api/categories — return empty list until categories are built out
export async function GET(_req: NextRequest) {
  return ok({ categories: [] });
}
