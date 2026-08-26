import type { Metadata } from "next";
import {
  CONTENT_LINK_META,
  contentDeepLink,
  resolveContentLink,
  type ContentLinkType,
} from "@/lib/frontend/content-link";
import { ContentLinkShell, ContentLinkNotFound } from "@/app/link-shell";

const TYPE: ContentLinkType = "video";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const preview = await resolveContentLink(TYPE, id);
  if (!preview) {
    return {
      title: "Link not found — MeetSweet",
      description: "This MeetSweet link has expired or no longer exists.",
    };
  }
  const meta = CONTENT_LINK_META[TYPE];
  const title = preview?.title ?? `MeetSweet ${meta.label}`;
  const description =
    preview?.description?.slice(0, 160) ?? `Open this ${meta.label.toLowerCase()} in the MeetSweet app.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "MeetSweet",
      type: "website",
      ...(preview?.imageUrl ? { images: [{ url: preview.imageUrl }] } : {}),
    },
    twitter: {
      card: preview?.imageUrl ? "summary_large_image" : "summary",
      title,
      description,
      ...(preview?.imageUrl ? { images: [preview.imageUrl] } : {}),
    },
  };
}

export default async function VideoLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const preview = await resolveContentLink(TYPE, id);
  if (!preview) return <ContentLinkNotFound />;

  return (
    <ContentLinkShell
      deepLink={contentDeepLink(TYPE, id)}
      meta={CONTENT_LINK_META[TYPE]}
      preview={preview}
    />
  );
}
