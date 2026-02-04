import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type NudgeBody = {
  action: "nudge";
  tripId: string;
  driverId: string;
  note?: string | null;
};

type ReassignBody = {
  action: "reassign";
  tripId: string;
  fromDriverId: string;
  toDriverId: string;
  note?: string | null;
};

type EmergencyBody = {
  action: "emergency";
  tripId: string;
  isEmergency: boolean;
};

type Body = NudgeBody | ReassignBody | EmergencyBody;

export async function POST(req: NextRequest) {
  const supabase = createClient();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  try {
    if (body.action === "nudge") {
      const { data, error } = await supabase.rpc("admin_nudge_driver", {
        p_trip_id: body.tripId,
        p_driver_id: body.driverId,
        p_note: body.note ?? null,
      });

      if (error) {
        console.error("admin_nudge_driver error:", error);
        return NextResponse.json(
          { error: error.message || "Failed to nudge driver." },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { message: "Nudge sent to driver.", data },
        { status: 200 }
      );
    }

    if (body.action === "reassign") {
      const { data, error } = await supabase.rpc("admin_reassign_trip", {
        p_trip_id: body.tripId,
        p_from_driver_id: body.fromDriverId,
        p_to_driver_id: body.toDriverId,
        p_note: body.note ?? null,
      });

      if (error) {
        console.error("admin_reassign_trip error:", error);
        return NextResponse.json(
          { error: error.message || "Failed to reassign trip." },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { message: "Trip reassign saved.", data },
        { status: 200 }
      );
    }

    if (body.action === "emergency") {
      const { data, error } = await supabase.rpc("admin_set_trip_emergency", {
        p_trip_id: body.tripId,
        p_is_emergency: body.isEmergency,
      });

      if (error) {
        console.error("admin_set_trip_emergency error:", error);
        return NextResponse.json(
          { error: error.message || "Failed to update emergency flag." },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
          message: body.isEmergency
            ? "Trip marked as EMERGENCY."
            : "Emergency flag cleared.",
          data,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { error: "Unknown action type." },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("Dispatch actions API fatal error:", err);
    return NextResponse.json(
      { error: "Unexpected error processing dispatch action." },
      { status: 500 }
    );
  }
}
