import { auth } from "@/auth";
import { homeFor } from "@/lib/roles";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();
  const role = session?.user?.role ?? "user";
  // If you want logged-in users to go straight to their home:
  if (session?.user) {
    redirect(homeFor(role));
  }

  // Public welcome for logged-out users
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Welcome 👋</h1>
      <p>If you just signed in, landing here means redirects are now clean.</p>
    </main>
  );
}
