import { handlers } from "../../../../auth";

// force node runtime (Auth.js really prefers a Node-ish runtime, not edge)
export const runtime = "nodejs";

// NextAuth's route handler supports *all* /api/auth/* subroutes,
// including /signin/google, /callback/google, /error, etc.
export const GET = handlers.GET;
export const POST = handlers.POST;
