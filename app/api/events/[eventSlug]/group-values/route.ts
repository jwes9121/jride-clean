import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _req: Request,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,slug,group_label")
      .eq("slug", params.eventSlug)
      .in("status", [
        "published",
        "registration_open",
        "registration_closed",
        "live",
        "completed",
      ])
      .maybeSingle();

    if (eventError) throw new Error(eventError.message);

    if (!event?.id) {
      return NextResponse.json(
        { success: false, error: "Event not found." },
        { status: 404 }
      );
    }

    const { data: values, error: valuesError } = await supabase
      .from("event_group_values")
      .select("value,label,sort_order")
      .eq("event_id", event.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (valuesError) throw new Error(valuesError.message);

    return NextResponse.json({
      success: true,
      eventSlug: event.slug,
      groupLabel: event.group_label,
      values: values || [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load group values.",
      },
      { status: 500 }
    );
  }
}