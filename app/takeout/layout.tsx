import TakeoutPassengerShell from "./TakeoutPassengerShell";
import "./takeout-jride.css";
import "./takeout-jride-v2.css";
import "./takeout-tracking.css";

export default function TakeoutLayout({ children }: { children: React.ReactNode }) {
  return <TakeoutPassengerShell>{children}</TakeoutPassengerShell>;
}
