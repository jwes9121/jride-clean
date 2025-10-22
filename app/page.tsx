// app/page.tsx (server component)
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function Page() {
  const session = await auth();

  if (!session) {
    // send to Google sign-in (same URL middleware uses)
    redirect("/api/auth/signin?provider=google");
  }

  // If you redirect to a role-based home, do it here. Example:
  // const role = session.user?.role ?? "user";
  // redirect(role === "driver" ? "/driver" : "/rider");

  // Or render a simple landing page for logged-in users:
  return <main className="p-6">Welcome ??</main>;
}
