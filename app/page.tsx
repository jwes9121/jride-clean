// app/page.tsx
import { auth } from "../auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function Home() {
  const session = await auth();
  if (session) redirect("/dashboard");
  redirect("/auth/signin");
}
