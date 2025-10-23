// middleware.ts (TEMPORARY)
export default function middleware() {
  // allow everything; no auth checks
  return;
}

// Protect nothing for now
export const config = {
  matcher: [],
};
