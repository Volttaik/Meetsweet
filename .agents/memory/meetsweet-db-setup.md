---
name: MeetSweet DB Setup
description: Database setup state and how to re-run schema if needed.
---

# MeetSweet DB Setup

## Current state
All 19 tables exist in the development PostgreSQL database:
bookmarks, categories, comments, conversation_participants, conversations, email_verifications, follows, likes, media, messages, notifications, post_categories, post_tags, posts, refresh_tokens, subscriptions, transactions, users, media.

Categories are pre-seeded: Art & Design, Music, Fitness, Photography, Gaming, Food & Cooking, Travel, Education, Comedy, Lifestyle.

## How to re-run
The full schema lives at `artifacts/api-server/src/db/schema.sql`. It uses `CREATE TABLE IF NOT EXISTS` and `INSERT ... ON CONFLICT DO NOTHING` so it is safe to re-run via `executeSql`.

**Why:** DATABASE_URL is runtime-managed by Replit — it is always available in the shell and in running workflows without any manual configuration.
