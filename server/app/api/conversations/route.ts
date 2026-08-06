import { NextRequest } from "next/server";
import { eq, and, desc, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, conversations, conversation_members, messages, creator_settings, subscriptions, blocked_users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const tab = req.nextUrl.searchParams.get("tab") ?? "all";
  const archived = tab === "archived";

  const memberships = await db
    .select({
      conversation_id: conversation_members.conversation_id,
      is_archived: conversation_members.is_archived,
      is_muted: conversation_members.is_muted,
      last_read_at: conversation_members.last_read_at,
      cleared_at: conversation_members.cleared_at,
      background: conversation_members.background,
    })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.user_id, auth.user.userId),
        eq(conversation_members.is_archived, archived),
      ),
    );

  if (memberships.length === 0) return ok({ conversations: [] });

  const convIds = memberships.map((m) => m.conversation_id);

  const result = [];
  for (const convId of convIds) {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId))
      .limit(1);
    if (!conv) continue;

    const membership = memberships.find((m) => m.conversation_id === convId)!;

    // Get all members of the conversation, then pick the other user
    const allMembers = await db
      .select({
        user_id: conversation_members.user_id,
        full_name: users.full_name,
        display_name: profiles.display_name,
        username: users.username,
        avatar_url: profiles.avatar_url,
        is_verified: users.is_verified,
      })
      .from(conversation_members)
      .innerJoin(users, eq(users.id, conversation_members.user_id))
      .leftJoin(profiles, eq(profiles.user_id, conversation_members.user_id))
      .where(eq(conversation_members.conversation_id, convId));

    const otherMember = allMembers.find((m) => m.user_id !== auth.user.userId);

    // Fetch last message body — respect the caller's cleared_at cutoff
    const lastMsgWhere = membership.cleared_at
      ? and(
          eq(messages.conversation_id, convId),
          sql`${messages.created_at} > ${membership.cleared_at}`,
        )
      : eq(messages.conversation_id, convId);

    const [lastMsg] = await db
      .select({ body: messages.body, created_at: messages.created_at })
      .from(messages)
      .where(lastMsgWhere)
      .orderBy(desc(messages.created_at))
      .limit(1);

    // Count unread messages (messages after last_read_at from other users)
    // Also respect cleared_at — cleared messages don't count as unread.
    let unread_count = 0;
    const unreadConditions = [
      eq(messages.conversation_id, convId),
      sql`${messages.sender_id} != ${auth.user.userId}`,
      ...(membership.last_read_at
        ? [sql`${messages.created_at} > ${membership.last_read_at}`]
        : []),
      ...(membership.cleared_at
        ? [sql`${messages.created_at} > ${membership.cleared_at}`]
        : []),
    ];
    const [unreadRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(and(...unreadConditions));
    unread_count = unreadRow?.count ?? 0;

    result.push({
      id: conv.id,
      lastMessageBody: lastMsg?.body ?? null,
      last_message_body: lastMsg?.body ?? null,
      lastMessageAt: conv.last_message_at,
      last_message_at: conv.last_message_at,
      createdAt: conv.created_at,
      created_at: conv.created_at,
      isMuted: membership.is_muted,
      is_muted: membership.is_muted,
      isArchived: membership.is_archived,
      is_archived: membership.is_archived,
      unreadCount: unread_count,
      unread_count,
      background: membership.background ?? null,
      // camelCase for mobile normalizer
      otherUser: otherMember
        ? {
            id: otherMember.user_id,
            name: otherMember.display_name ?? otherMember.full_name,
            display_name: otherMember.display_name ?? otherMember.full_name,
            displayName: otherMember.display_name ?? otherMember.full_name,
            username: otherMember.username,
            avatar_url: otherMember.avatar_url,
            avatarUrl: otherMember.avatar_url,
            is_verified: otherMember.is_verified,
            isVerified: otherMember.is_verified,
          }
        : null,
    });
  }

  result.sort((a, b) => {
    const aTime = a.last_message_at ?? a.created_at;
    const bTime = b.last_message_at ?? b.created_at;
    return bTime.localeCompare(aTime);
  });

  return ok({ conversations: result });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  // Accept user_id / userId (UUID) OR username — the creator page sends username
  const schema = z.object({
    userId: z.string().min(1).optional(),
    user_id: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
  });

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const { userId, user_id, username } = parsed.data;
  if (!userId && !user_id && !username) {
    return err("userId, user_id, or username is required", 400);
  }

  // Resolve target user — by UUID or username.
  // Strategy: if `username` is explicitly provided, use it. Otherwise try the
  // raw identifier as a UUID first; if that returns nothing, fall back to a
  // username match (some clients pass username in the user_id / userId field).
  const rawId = userId ?? user_id ?? null;

  const lookupCondition = username
    ? eq(users.username, username)
    : eq(users.id, rawId!);

  let [targetUser] = await db
    .select({
      id: users.id,
      username: users.username,
      full_name: users.full_name,
      is_creator: users.is_creator,
      is_verified: users.is_verified,
    })
    .from(users)
    .where(and(lookupCondition, eq(users.is_active, true)))
    .limit(1);

  // Fallback: if UUID lookup missed, try treating the identifier as a username
  if (!targetUser && !username && rawId) {
    const [fallback] = await db
      .select({
        id: users.id,
        username: users.username,
        full_name: users.full_name,
        is_creator: users.is_creator,
        is_verified: users.is_verified,
      })
      .from(users)
      .where(and(eq(users.username, rawId), eq(users.is_active, true)))
      .limit(1);
    if (fallback) targetUser = fallback;
  }

  if (!targetUser) return err("User not found", 404);
  if (targetUser.id === auth.user.userId) {
    return err("Cannot start a conversation with yourself", 400);
  }

  // ── Block check ──────────────────────────────────────────────────────────
  // If caller blocked the target, or target blocked the caller, messaging is forbidden.
  const [blockRecord] = await db
    .select({ id: blocked_users.id })
    .from(blocked_users)
    .where(
      or(
        and(
          eq(blocked_users.blocker_id, auth.user.userId),
          eq(blocked_users.blocked_id, targetUser.id),
        ),
        and(
          eq(blocked_users.blocker_id, targetUser.id),
          eq(blocked_users.blocked_id, auth.user.userId),
        ),
      ),
    )
    .limit(1);

  if (blockRecord) {
    return err("You cannot message this user", 403, { code: "user_blocked" });
  }

  // ── Messaging permission check ───────────────────────────────────────────
  // Applies when the target is a creator. Regular users (is_creator=false) can
  // always receive DMs — only creators gate their inbox.
  if (targetUser.is_creator) {
    const [settings] = await db
      .select({
        allow_dms: creator_settings.allow_dms,
        who_can_message: creator_settings.who_can_message,
      })
      .from(creator_settings)
      .where(eq(creator_settings.user_id, targetUser.id))
      .limit(1);

    const allowDms = settings?.allow_dms ?? true;
    const whoCanMessage = settings?.who_can_message ?? "everyone";

    if (!allowDms || whoCanMessage === "none") {
      return err("This creator has disabled direct messages", 403, {
        code: "dms_disabled",
        creator_id: targetUser.id,
        username: targetUser.username,
        // Mobile uses this to navigate to the creator profile and show the restriction
        redirect_to: `creator/${targetUser.username ?? targetUser.id}`,
      });
    }

    if (whoCanMessage === "subscribers") {
      const [sub] = await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.subscriber_id, auth.user.userId),
            eq(subscriptions.creator_id, targetUser.id),
            eq(subscriptions.status, "active"),
          ),
        )
        .limit(1);

      if (!sub) {
        const publicAppUrl = process.env.PUBLIC_APP_URL ?? "https://meetsweet.space";
        return err("You must subscribe to message this creator", 403, {
          code: "subscription_required",
          creator_id: targetUser.id,
          username: targetUser.username,
          // Mobile uses this to navigate directly to the creator's subscribe page
          redirect_to: `creator/${targetUser.username ?? targetUser.id}`,
          redirect_url: `${publicAppUrl}/creators/${targetUser.username ?? targetUser.id}`,
        });
      }
    }
  }

  // ── Helper: fetch target user's profile for response ────────────────────
  const [targetProfile] = await db
    .select({ display_name: profiles.display_name, avatar_url: profiles.avatar_url })
    .from(profiles)
    .where(eq(profiles.user_id, targetUser.id))
    .limit(1);

  const otherUser = {
    id: targetUser.id,
    name: targetProfile?.display_name ?? targetUser.full_name,
    display_name: targetProfile?.display_name ?? targetUser.full_name,
    displayName: targetProfile?.display_name ?? targetUser.full_name,
    username: targetUser.username,
    avatar_url: targetProfile?.avatar_url ?? null,
    avatarUrl: targetProfile?.avatar_url ?? null,
    is_verified: targetUser.is_verified,
    isVerified: targetUser.is_verified,
    is_creator: targetUser.is_creator,
    isCreator: targetUser.is_creator,
  };

  // ── Return existing conversation if one already exists ───────────────────
  const myConvs = await db
    .select({ conversation_id: conversation_members.conversation_id })
    .from(conversation_members)
    .where(eq(conversation_members.user_id, auth.user.userId));

  const myConvIds = myConvs.map((m) => m.conversation_id);

  for (const convId of myConvIds) {
    const [match] = await db
      .select({ id: conversation_members.id })
      .from(conversation_members)
      .where(
        and(
          eq(conversation_members.conversation_id, convId),
          eq(conversation_members.user_id, targetUser.id),
        ),
      )
      .limit(1);
    if (match) {
      // Return full conversation shape so mobile can open it without a second request
      return ok({
        conversationId: convId,
        conversation_id: convId,
        created: false,
        otherUser,
        other_user: otherUser,
      });
    }
  }

  // ── Create new conversation ──────────────────────────────────────────────
  const convId = generateId();
  await db.insert(conversations).values({ id: convId, type: "direct", created_by: auth.user.userId });
  await db.insert(conversation_members).values([
    { id: generateId(), conversation_id: convId, user_id: auth.user.userId },
    { id: generateId(), conversation_id: convId, user_id: targetUser.id },
  ]);

  return created({
    conversationId: convId,
    conversation_id: convId,
    created: true,
    otherUser,
    other_user: otherUser,
  });
}
