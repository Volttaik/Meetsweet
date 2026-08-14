// Alias for the mobile app's `GET /creator/dashboard` call.
// The statistics route already returns the { period_stats, active_subscribers,
// total_posts, total_revenue } shape the dashboard expects.
export { GET } from "../statistics/route";
