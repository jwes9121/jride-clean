import { auth } from "@/auth";
import { homeFor, type AppRole } from "@/lib/roles";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();

  // Assert because we removed NextAuth type augmentation.
  const role = (((session?.user as any)?.role) ?? "user") as AppRole;

  if (session?.user) {
    redirect(homeFor(role));
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Welcome ??</h1>
      <p>If you just signed in, landing here means redirects are now clean.</p>
    </main>
  );
}


