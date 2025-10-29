// middleware.ts at project root
import { auth } from "./auth"

export default auth((req) => {
  // you can add custom logic here if needed
})

export const config = {
  matcher: [
    // PROTECT these:
    "/admin/:path*",
    "/dispatch/:path*",
    "/whoami",
    "/api/secure/:path*",

    // DO NOT protect:
    // - /api/auth/*
    // - /auth/*
    // - static assets
    // - _next/*
    // - favicon, etc.
  ],
}
