import type { ReactNode } from "react";
import "./ride-unified.css";

export default function RideLayout({ children }: { children: ReactNode }) {
  return (
    <div className="jride-ride-route-shell">
      <header className="jride-ride-service-header">
        <div className="min-w-0">
          <div className="jride-ride-eyebrow">JRIDE PASSENGER</div>
          <h1>Ride</h1>
          <p>Set your pickup and destination, then request a driver.</p>
        </div>
        <nav aria-label="Ride service navigation">
          <a href="/passenger">Home</a>
          <a href="/history">History</a>
        </nav>
      </header>
      {children}
    </div>
  );
}
