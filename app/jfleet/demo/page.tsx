import { notFound } from "next/navigation";
import DemoClient from "./DemoClient";

export const dynamic = "force-dynamic";

export default function JFleetDemoPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <DemoClient />;
}
