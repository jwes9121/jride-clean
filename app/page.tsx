import { auth } from "../auth";
import { redirect } from "next/navigation";

// disable caching completely
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function Home() {
  const session = await auth();

  // Go directly to dashboard if logged in
  if (session) {
    redirect("/dashboard");
  }

  // If not logged in, go to sign-in page
  redirect("/auth/signin");
}
