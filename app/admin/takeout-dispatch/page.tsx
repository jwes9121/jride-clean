import { redirect } from "next/navigation";

export default function LegacyTakeoutDispatchPage() {
  redirect("/admin/livetrips?service=takeout");
}
