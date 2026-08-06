/**
 * POST /api/auth/resend
 *
 * Short-path alias for /api/auth/resend-verification.
 * Some mobile clients call this shorter path.
 */
export { POST } from "@/app/api/auth/resend-verification/route";
