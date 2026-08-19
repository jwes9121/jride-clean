import type { Metadata } from "next";
import MyWalkRecoveryClient from "./MyWalkRecoveryClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Find My Event Pass and My Live Walk",
  robots: {
    index: false,
    follow: false,
  },
};

export default function MyWalkRecoveryPage({
  params,
}: {
  params: {
    eventSlug: string;
  };
}) {
  return (
    <MyWalkRecoveryClient
      eventSlug={params.eventSlug}
    />
  );
}