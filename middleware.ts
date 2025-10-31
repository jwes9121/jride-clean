import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// For now: no auth gating to avoid loops. We can re-introduce later with a proper matcher.
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

// Explicitly limit to app routes and exclude Next internals & assets
export const config = {
  matcher: [
    // Everything except:
    // - _next
    // - static assets (extension)
    // - api/auth, api/eta
    // - favicon
    "/((?!_next/|.*\\..*|api/auth|api/eta|favicon.ico).*)",
  ],
};
