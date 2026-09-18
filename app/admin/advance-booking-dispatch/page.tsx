import { redirect } from "next/navigation";

export default function LegacyAdvanceBookingDispatchPage() {
  redirect("/admin/livetrips?service=advance");
}
