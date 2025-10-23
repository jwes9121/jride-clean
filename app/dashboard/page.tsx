import { auth } from "../../auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function Dashboard() {
  const session = await auth();

  if (!session) {
    redirect("/auth/signin");
  }

  return (
    <main className="p-6">
      <h1>Dashboard</h1>
      <p>Session active for {session.user?.email}</p>
    </main>
  );
}
