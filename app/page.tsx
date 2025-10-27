import { auth, handlers, signIn, signOut } from "@/configs/nextauth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const session = await auth();
  if (session) redirect("/dashboard?fresh=1");
  redirect("/auth/signin?fresh=1");
}

