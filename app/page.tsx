import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();

  // If logged in, send them to their landing page once.
  if (session?.user) {
    // Change to whatever your app uses, e.g. /landing or /driver
    redirect("/landing");
  }

  // If not logged in, show a neutral page with a sign-in link.
  // (No automatic redirect.)
  return (
    <main className="p-6">
      <h1>Welcome</h1>
      <p>If you just signed in, landing here means redirects are clean.</p>
      <a href="/api/auth/signin?provider=google">Sign in with Google</a>
    </main>
  );
}
