import { NextRequest } from "next/server";
import { err, ok } from "@/lib/api/response";
import { lookupReferral } from "@/lib/services/referrals";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const referrer = await lookupReferral(code);
  if (!referrer) return err("Referral link not found", 404, "REFERRAL_NOT_FOUND");
  return ok({
    code: referrer.code,
    referrer: {
      id: referrer.creator_id,
      name: referrer.creator_name,
      username: referrer.creator_username,
    },
  });
}
