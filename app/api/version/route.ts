export async function GET() {
  return Response.json({
    env: process.env.VERCEL_ENV,
    branch: process.env.VERCEL_GIT_COMMIT_REF,
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
    builtAt: new Date().toISOString()
  });
}

