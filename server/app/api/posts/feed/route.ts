// Static alias for the mobile app's `GET /posts/feed?page=` home-feed call.
// The handler in ../route detects the `/posts/feed` pathname and serves the
// subscription-aware home feed.
export { GET } from "../route";
