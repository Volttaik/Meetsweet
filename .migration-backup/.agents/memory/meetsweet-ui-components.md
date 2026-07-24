---
name: MeetSweet UI Component Map
description: Locations of all screens, shared components, hooks, services, and reusable UI in the MeetSweet Expo app.
---

## Screens (artifacts/meetsweet/app/)

- `(tabs)/index.tsx` — Home feed (FlatList, MsPostCard, pull-to-refresh, pagination)
- `(tabs)/explore.tsx` — Explore screen (categories, creator cards, search, creator preview modal)
- `(tabs)/messages.tsx` — Messages list (conversation rows, long-press action sheet, new message modal)
- `(tabs)/profile.tsx` — Own profile (avatar, stats, posts/media/saved grid tabs)
- `(tabs)/_layout.tsx` — Custom tab bar (animated scale, badge dot support via `TabBadgeDot`)
- `notifications.tsx` — Notification list (grouped by Today/Yesterday/Earlier, MsAvatar with avatarUrl)
- `creator/[id].tsx` — Creator public profile (subscribe flow via HeroUI BottomSheet)
- `chat/[id].tsx` — Chat/conversation screen
- `create-post.tsx` — Post creation
- `wallet.tsx` — Credits wallet
- `settings.tsx` — App settings
- `edit-profile.tsx` — Edit profile

## Shared Components (artifacts/meetsweet/components/)

- `MsAvatar.tsx` — Circular avatar with initials fallback, fade-in Animated.Image, online dot, badge count
- `MsCreatorCard.tsx` — Creator card (compact = avatar+name, featured = full card with subscriber count, price, category, subscribe button)
- `MsCreatorPreview.tsx` — Bottom-sheet preview modal when tapping a creator avatar; props: creator, onViewProfile, onSubscribe
- `MsActionSheet.tsx` — Reusable native-feeling context menu bottom sheet; ActionItem[] with optional destructive flag
- `MsPostCard.tsx` — Post card with like/bookmark/comment actions, long-press action sheet (own vs guest options), scale-on-press for media
- `MsExploreVisual.tsx` — MsFeaturedCreatorCard, MsRecommendedCreatorRow, MsPreviewCard, MsCollectionCard, MsCatalogSkeleton, MsCreatorIdentity
- `MsEmptyState.tsx` — Empty state with Sparkle icon, title, message, optional action button
- `MsSkeletonCard.tsx` — MsSkeletonCard, MsSkeletonRow, MsPostSkeleton (HeroUI Skeleton-based)
- `MsSectionHeader.tsx` — Section header with optional action label
- `MsNotificationCard.tsx` — Notification card component
- `KeyboardAwareScrollViewCompat.tsx` — Keyboard-aware scroll
- `ErrorBoundary.tsx` / `ErrorFallback.tsx` — Error boundaries
- `ScreenTransition.tsx` — Screen fade transition wrapper
- `StepIndicator.tsx` — Multi-step progress dots
- `OTPInput.tsx` — OTP code input
- `MsInput.tsx` — Styled text input

## Services (artifacts/meetsweet/services/)

- `posts.ts` — getFeed, getUserPosts, getBookmarkedPosts, likePost, unlikePost, bookmarkPost, unbookmarkPost, deletePost, reportPost
- `messages.ts` — getConversations, searchUsers, createConversation; types: Conversation, ConversationUser
- `notifications.ts` — getNotifications, markNotificationRead, markAllNotificationsRead; type: Notification
- `auth.ts` — login, register, logout, etc.

## Contexts

- `contexts/AuthContext.tsx` — useAuth() → { user, refreshUser, ... }

## Constants

- `constants/theme.ts` — T.BG, T.SURFACE, T.TEXT, T.FONT.*, T.RADIUS.*, T.SUCCESS, T.ERROR

## API Client

- `lib/api-client-react/` — React Query hooks auto-generated from OpenAPI spec
- `useGetExploreCatalog()` — returns { creators, categories, previews, featuredCreatorIds, recommendedCreatorIds, trendingSearches, creditBalance, collections }
- Types: Creator, ContentPreview, TrendingCollection from @workspace/api-client-react

## Key Patterns

- **Long-press menus**: MsActionSheet (Modal-based, not Alert.alert). Used in MsPostCard, messages.tsx, explore.tsx
- **Creator preview**: MsCreatorPreview shown when tapping creator avatar. Used in explore.tsx; pass `onAvatarPress` to MsFeaturedCreatorCard / MsRecommendedCreatorRow
- **Avatar fade-in**: MsAvatar uses Animated.Image with opacity 0→1 on onLoad; initials always rendered underneath
- **Explore categories**: Local CREATOR_CATEGORIES array in explore.tsx (20 creator-focused categories). Filter logic in `creatorMatchesCategory()` handles special cases (trending, new, premium)
- **Tab bar badges**: TabBadgeDot in (tabs)/_layout.tsx — reads `badge` field from VISUAL_TABS array. Wire up by setting badge count in the array when real data is available
- **Typecheck**: Run `pnpm run typecheck:libs` first (builds lib/api-client-react) before `pnpm --filter @workspace/meetsweet run typecheck` to avoid cascading TS6305 errors
- **Style naming pitfall**: Never use `handle` as both a drag-pill style AND a text style in the same StyleSheet — TypeScript will flag duplicate property + View/Text style mismatch

**Why:** Future agents should locate any component or screen instantly without grepping.
**How to apply:** Check this map before reading files. Update when new screens/components are added.
