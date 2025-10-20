export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ version: process.env.npm_package_version ?? "dev" });
}

