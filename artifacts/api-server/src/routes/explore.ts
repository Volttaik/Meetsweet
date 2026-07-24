import { Router, type IRouter } from "express";
import { query, queryOne } from "../lib/db.js";
import { GetExploreCatalogResponse } from "@workspace/api-zod";
import { optionalAuth, type AuthRequest } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

// Static fallback arrays for content that has no DB equivalent
const TRENDING_SEARCHES = [
  "slow living",
  "new creators",
  "exclusive",
  "music rooms",
  "visual diaries",
  "wellness",
];

const GRADIENT_OPTIONS = [
  "mono-sand",
  "mono-mist",
  "mono-slate",
  "mono-ink",
  "mono-cloud",
  "mono-charcoal",
  "mono-stone",
  "mono-fog",
];

function pickGradient(index: number): string {
  return GRADIENT_OPTIONS[index % GRADIENT_OPTIONS.length];
}

function formatFollowers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

router.get("/explore", optionalAuth, async (req: AuthRequest, res) => {
  try {
    // Fetch all data in parallel
    const [categoriesRaw, creatorsRaw, postsRaw, userRow] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT id, name, slug, post_count FROM categories ORDER BY name`,
      ),
      query<Record<string, unknown>>(
        `SELECT id, name, username, bio, avatar_url, is_verified, is_creator,
                follower_count, subscriber_count, post_count
         FROM users
         WHERE is_creator = true OR post_count > 0
         ORDER BY follower_count DESC
         LIMIT 20`,
      ),
      query<Record<string, unknown>>(
        `SELECT id, user_id, caption, media_url, media_type, thumbnail_url,
                is_premium, price_credits, like_count
         FROM posts
         WHERE visibility = 'public' AND is_archived = false
         ORDER BY created_at DESC
         LIMIT 12`,
      ),
      req.user
        ? queryOne<{ credits: number }>(
            `SELECT credits FROM users WHERE id = $1`,
            [req.user.sub],
          )
        : Promise.resolve(null),
    ]);

    // Map categories to schema shape
    const categories = [
      { id: "all", label: "All", count: categoriesRaw.reduce((s, c) => s + Number(c.post_count ?? 0), 0) },
      ...categoriesRaw.map((c) => ({
        id: String(c.slug),
        label: String(c.name),
        count: Number(c.post_count ?? 0),
      })),
    ];

    // Map creators to schema shape
    const creators = creatorsRaw.map((u, i) => {
      const name = String(u.name ?? "Creator");
      const words = name.trim().split(" ");
      const initials = words.slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("");
      return {
        id: String(u.id),
        name,
        handle: `@${u.username}`,
        initials,
        bio: String(u.bio ?? ""),
        category: "Lifestyle",
        followers: formatFollowers(Number(u.follower_count ?? 0)),
        subscriberCount: Number(u.subscriber_count ?? 0),
        monthlyCredits: 500,
        isVerified: Boolean(u.is_verified),
        isOnline: false,
        gradient: pickGradient(i),
      };
    });

    // Map posts to content previews
    const previews = postsRaw.map((p, i) => {
      const caption = String(p.caption ?? "").slice(0, 60);
      const isPremium = Boolean(p.is_premium);
      return {
        id: String(p.id),
        creatorId: String(p.user_id),
        title: caption || "Untitled",
        category: "Lifestyle",
        kind: (p.media_type as string) || "photo",
        duration: "",
        likes: formatFollowers(Number(p.like_count ?? 0)),
        isPremium,
        gradient: pickGradient(i),
        lockedLabel: isPremium
          ? `${p.price_credits ?? 500} credits`
          : "Free preview",
      };
    });

    // Featured = first 3 creators; recommended = next 5
    const featuredCreatorIds = creators.slice(0, 3).map((c) => c.id);
    const recommendedCreatorIds = creators.slice(3, 8).map((c) => c.id);

    const catalog = GetExploreCatalogResponse.parse({
      creditBalance: userRow?.credits ?? 0,
      categories,
      trendingSearches: TRENDING_SEARCHES,
      featuredCreatorIds,
      recommendedCreatorIds,
      creators,
      previews,
      collections: [
        { id: "collection-1", title: "Quiet luxury", subtitle: "A slower kind of feed", itemCount: 18, gradient: "mono-sand" },
        { id: "collection-2", title: "Behind the build", subtitle: "Creators making things", itemCount: 24, gradient: "mono-slate" },
        { id: "collection-3", title: "New this week", subtitle: "Fresh voices to know", itemCount: 12, gradient: "mono-mist" },
      ],
    });

    res.json(catalog);
  } catch (err) {
    console.error("Explore error:", err);
    // Fallback: serve empty catalog rather than crashing
    try {
      const fallback = GetExploreCatalogResponse.parse({
        creditBalance: 0,
        categories: [{ id: "all", label: "All", count: 0 }],
        trendingSearches: TRENDING_SEARCHES,
        featuredCreatorIds: [],
        recommendedCreatorIds: [],
        creators: [],
        previews: [],
        collections: [],
      });
      res.json(fallback);
    } catch {
      res.status(500).json({ error: "Failed to fetch explore catalog" });
    }
  }
});

export default router;
