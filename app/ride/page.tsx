import TrackClient from "./track/TrackClient";
import SimpleBookRide from "./SimpleBookRide";

type RidePageProps = {
  searchParams?: {
    booking_code?: string;
    code?: string;
  };
};

export default function RidePage({ searchParams }: RidePageProps) {
  const bookingCode =
    (searchParams?.booking_code || searchParams?.code || "").trim();

  if (!bookingCode) {
    return (
      <div className="p-4">
        <SimpleBookRide />
      </div>
    );
  }

  return (
    <div className="p-4">
      <TrackClient code={bookingCode} />
    </div>
  );
}