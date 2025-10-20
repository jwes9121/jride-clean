import { platformDeduction } from "@/lib/fare";
import { auth } from "@/auth";

export default async function RequestSuccessPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const total = Number(searchParams?.total ?? 0);
  const count = Number(searchParams?.count ?? 1);
  const id = typeof searchParams?.id === "string" ? searchParams?.id : undefined;

  const session = await auth().catch(() => null);
  const name = session?.user?.name ?? "Passenger";

  const deduction = platformDeduction(total);
  const net = total - deduction;

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-2">Booking Confirmed ðŸŽ‰</h1>
      <p className="text-sm mb-4">Thank you, {name}. Your tricycle booking has been placed.</p>

      <div className="rounded-lg border p-4 text-sm space-y-1">
        {id && <p>â€¢ Booking ID: <span className="font-mono">{id}</span></p>}
        <p>â€¢ Passengers: {count}</p>
        <p>â€¢ Total Fare (Pay to driver): <span className="font-semibold">â‚±{total}</span></p>
      </div>

      <p className="text-xs text-gray-600 mt-4">
        Note: Platform deduction of â‚±{deduction} (if applicable) is taken from the driver payout, not from your payment.
        Driver net payout example for this trip would be â‚±{net}.
      </p>

      <div className="mt-6 flex gap-3">
        <a href="/history" className="px-4 py-2 rounded border text-center">View History</a>
        <a href="/request" className="px-4 py-2 rounded bg-blue-600 text-white text-center">New Booking</a>
      </div>
    </main>
  );
}


