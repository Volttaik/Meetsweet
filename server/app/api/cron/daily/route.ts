import { NextRequest, NextResponse } from "next/server";
import { expirePosts } from "@/services/maintenance/expirePosts";
import { expireSubscriptions } from "@/services/maintenance/expireSubscriptions";
import { cleanupVerificationCodes } from "@/services/maintenance/cleanupVerificationCodes";
import { cleanupSessions } from "@/services/maintenance/cleanupSessions";
import { cleanupRefreshTokens } from "@/services/maintenance/cleanupRefreshTokens";

// Called by Vercel Cron — secured with CRON_SECRET header
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization");
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const tasksCompleted: string[] = [];
  const tasksFailed: Array<{ task: string; error: string }> = [];

  console.log(`[cron/daily] starting at ${new Date().toISOString()}`);

  // 1. Expire posts older than their expires_at
  try {
    const result = await expirePosts();
    tasksCompleted.push(`expirePosts (archived: ${result.archived})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tasksFailed.push({ task: "expirePosts", error: msg });
    console.error("[cron/daily] expirePosts failed:", msg);
  }

  // 2. Expire active subscriptions past their expires_at
  try {
    const result = await expireSubscriptions();
    tasksCompleted.push(`expireSubscriptions (expired: ${result.expired})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tasksFailed.push({ task: "expireSubscriptions", error: msg });
    console.error("[cron/daily] expireSubscriptions failed:", msg);
  }

  // 3. Delete expired / used verification codes
  try {
    const result = await cleanupVerificationCodes();
    tasksCompleted.push(`cleanupVerificationCodes (deleted: ${result.deleted})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tasksFailed.push({ task: "cleanupVerificationCodes", error: msg });
    console.error("[cron/daily] cleanupVerificationCodes failed:", msg);
  }

  // 4. Delete expired sessions
  try {
    const result = await cleanupSessions();
    tasksCompleted.push(`cleanupSessions (deleted: ${result.deleted})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tasksFailed.push({ task: "cleanupSessions", error: msg });
    console.error("[cron/daily] cleanupSessions failed:", msg);
  }

  // 5. Delete expired / revoked refresh tokens
  try {
    const result = await cleanupRefreshTokens();
    tasksCompleted.push(`cleanupRefreshTokens (deleted: ${result.deleted})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tasksFailed.push({ task: "cleanupRefreshTokens", error: msg });
    console.error("[cron/daily] cleanupRefreshTokens failed:", msg);
  }

  const executionTime = Date.now() - startTime;

  console.log(
    `[cron/daily] finished in ${executionTime}ms — ` +
      `completed: ${tasksCompleted.length}, failed: ${tasksFailed.length}`
  );

  return NextResponse.json({
    success: tasksFailed.length === 0,
    tasksCompleted,
    tasksFailed,
    executionTime,
  });
}
