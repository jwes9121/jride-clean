import { redirect } from "next/navigation";

export default function LegacyAdminDispatchPage() {
  redirect("/admin/livetrips");
}
