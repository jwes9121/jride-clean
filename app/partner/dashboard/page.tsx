export default function Page() {
  return (
    <main style={{ padding: "40px", fontFamily: "Arial, sans-serif" }}>
      <h1>JRide Partner Dashboard</h1>
      <p>Partner portal is active. Territory access is enforced by the partner APIs.</p>
      <ul>
        <li><a href="/partner/livetrips">LiveTrips</a></li>
        <li><a href="/partner/analytics">Analytics</a></li>
        <li><a href="/partner/wallet">Wallet</a></li>
      </ul>
    </main>
  );
}
