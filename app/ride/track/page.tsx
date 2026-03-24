"use client";

import TrackClient from "./TrackClient";

type PageProps = {
  searchParams?: {
    code?: string;
    booking_code?: string;
  };
};

export default function Page({ searchParams }: PageProps) {
  const code = String(
    searchParams?.code ||
      searchParams?.booking_code ||
      ""
  ).trim();

  return <TrackClient code={code} />;
}