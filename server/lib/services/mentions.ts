/**
 * Mentions service — @username tag notifications.
 *
 * When a user tags others with @username (in a post caption or comment), each
 * tagged user is notified: an in-app notification row + push, both gated by
 * the TAGGED user's settings:
 *
 *   • privacy:  user_settings.allow_mentions — OFF blocks the tag entirely
 *               (the "Allow Mentions" privacy toggle, enforced server-side)
 *   • pref:     user_settings.notif_mentions — OFF suppresses the notification
 *               (the "Mentions" notification toggle)
 *
 * The actor is never notified for tagging themselves, invalid/nonexistent
 * usernames are ignored safely, and each post/comment produces at most ONE
 * notification per tagged user (extraction dedupes repeated mentions).
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, user_settings } from "@/lib/db/schema";
import { createNotification, sendPushToUser, getActorUsername } from "@/lib/services/push";

/** Safety cap on how many distinct users a single piece of text can tag. */
const MAX_MENTIONS = 10;

/**
 * Extract unique @username mentions from text (3–30 chars, letters/digits/
 * underscore — the same shape as usernames). Returns lowercased usernames,
 * deduped, capped at MAX_MENTIONS. Invalid formats are skipped by the regex.
 */
export function extractUsernames(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  // The @ must start a token (preceded by whitespace/start/punctuation) and be
  // followed by a boundary — so an email like user@example.com or a mid-word
  // @ is never mistaken for a tag.
  const re = /(?:^|[\s("'])[@]([a-zA-Z0-9_]{3,30})(?=$|[\s.,!?;:)"'])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const username = match[1].toLowerCase();
    if (!seen.has(username)) {
      seen.add(username);
      out.push(username);
    }
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

/**
 * Notify every user tagged via @username in `text`.
 *
 * @param entityType content_type of the parent entity (post | video | short |
 *                   album) so notification taps route to the right screen.
 * @param entityId   id of the parent entity (the post/album id).
 * @param entityTitle optional title/caption used for notification context.
 */
export async function notifyMentionedUsers(input: {
  actorId: string;
  text: string | null | undefined;
  entityType: string;
  entityId: string;
  entityTitle?: string | null;
}): Promise<void> {
  const usernames = extractUsernames(input.text);
  if (usernames.length === 0) return;

  try {
    // Resolve only REAL usernames — nonexistent ones are ignored safely.
    const rows = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.username, usernames))
      .limit(MAX_MENTIONS);
    if (rows.length === 0) return;

    const targetIds = rows.map((r) => r.id);
    const actorName = (await getActorUsername(input.actorId)).replace(/^@/, "");

    // Privacy gate: a tag is blocked when the TAGGED user turned off either
    // "Allow Mentions" or "Allow Tags" — both must be enabled to be taggable.
    const settingsRows = await db
      .select({
        user_id: user_settings.user_id,
        allow_mentions: user_settings.allow_mentions,
        allow_tags: user_settings.allow_tags,
      })
      .from(user_settings)
      .where(inArray(user_settings.user_id, targetIds));
    const allowTag = new Map(
      settingsRows.map((s) => [
        s.user_id,
        s.allow_mentions !== false && s.allow_tags !== false,
      ]),
    );

    const title = (input.entityTitle ?? "").trim();
    const action = title
      ? `tagged you in "${title.slice(0, 60)}"`
      : input.entityType === "comment"
        ? "tagged you in a comment"
        : "tagged you in a post";

    await Promise.all(
      rows
        // Never notify the author for tagging themselves.
        .filter((r) => r.id !== input.actorId)
        .filter((r) => allowTag.get(r.id) ?? true)
        .map(async (r) => {
          // In-app row — gated by the tagged user's notif_mentions preference
          // (createNotification checks the category before writing).
          await createNotification(r.id, "notif_mentions", {
            actor_id: input.actorId,
            type: "mention",
            entity_type: input.entityType,
            entity_id: input.entityId,
            body: action,
          });

          // Push — gated by notif_mentions (+ master push switch) server-side.
          await sendPushToUser(
            r.id,
            {
              title: "New Mention",
              body: `${actorName} ${action}`,
              data: {
                type: "mention",
                post_id: input.entityId,
                content_id: input.entityId,
                content_type: input.entityType,
                actor_id: input.actorId,
                actor_username: actorName,
              },
            },
            "notif_mentions",
          );
        }),
    );
  } catch {
    // Mention delivery is best-effort — never break post/comment creation.
  }
}
