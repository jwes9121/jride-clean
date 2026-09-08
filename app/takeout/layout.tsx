import TakeoutPassengerShell from "./TakeoutPassengerShell";
import "./takeout-jride.css";

export default function TakeoutLayout({ children }: { children: React.ReactNode }) {
  return <TakeoutPassengerShell>{children}</TakeoutPassengerShell>;
}
