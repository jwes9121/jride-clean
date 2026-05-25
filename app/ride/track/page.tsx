import TrackClient from "./TrackClient";

export default function Page({ searchParams }: { searchParams: any }) {
  const code = String(searchParams?.code || searchParams?.booking_code || "").trim();
  return <TrackClient code={code} />;
}