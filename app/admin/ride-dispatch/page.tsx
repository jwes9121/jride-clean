import { redirect } from "next/navigation";

export default function LegacyRideDispatchPage() {
  redirect("/admin/livetrips?service=ride");
}
