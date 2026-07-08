import { supabaseAdmin } from "@/lib/supabaseAdmin";

type BookingMode = "daytime" | "night";

type ScheduleRemindersInput = {
  advanceBookingId: string;
  passengerId: string;
  driverId?: string | null;
  scheduledPickupAt: Date;
  bookingMode: BookingMode;
};

type ScheduleRemindersResult =
  | { ok: true; created: number }
  | { ok: false; error: string };

function minutesBefore(base: Date, minutes: number): string {
  return new Date(base.getTime() - minutes * 60 * 1000).toISOString();
}

function isFuture(iso: string): boolean {
  return new Date(iso).getTime() > Date.now();
}

export async function scheduleAdvanceBookingReminders(
  input: ScheduleRemindersInput
): Promise<ScheduleRemindersResult> {
  const scheduledAt = input.scheduledPickupAt;

  if (!Number.isFinite(scheduledAt.getTime())) {
    return { ok: false, error: "INVALID_SCHEDULED_PICKUP_AT" };
  }

  const rows: Array<{
    advance_booking_id: string;
    target_type: "passenger" | "driver";
    target_id: string;
    reminder_type:
      | "24h_before"
      | "1h_before"
      | "30m_before"
      | "10m_before"
      | "15m_before";
    scheduled_for: string;
    requires_response: boolean;
  }> = [];

  const passenger24h = minutesBefore(scheduledAt, 24 * 60);
  const passenger30m = minutesBefore(scheduledAt, 30);
  const passenger10m = minutesBefore(scheduledAt, 10);

  if (isFuture(passenger24h)) {
    rows.push({
      advance_booking_id: input.advanceBookingId,
      target_type: "passenger",
      target_id: input.passengerId,
      reminder_type: "24h_before",
      scheduled_for: passenger24h,
      requires_response: false,
    });
  }

  if (isFuture(passenger30m)) {
    rows.push({
      advance_booking_id: input.advanceBookingId,
      target_type: "passenger",
      target_id: input.passengerId,
      reminder_type: "30m_before",
      scheduled_for: passenger30m,
      requires_response: false,
    });
  }

  if (isFuture(passenger10m)) {
    rows.push({
      advance_booking_id: input.advanceBookingId,
      target_type: "passenger",
      target_id: input.passengerId,
      reminder_type: "10m_before",
      scheduled_for: passenger10m,
      requires_response: false,
    });
  }

  if (input.driverId) {
    const driver24h = minutesBefore(scheduledAt, 24 * 60);
    const driver60m = minutesBefore(scheduledAt, 60);
    const driver30m = minutesBefore(scheduledAt, 30);
    const driver10m = minutesBefore(scheduledAt, 10);

    if (isFuture(driver24h)) {
      rows.push({
        advance_booking_id: input.advanceBookingId,
        target_type: "driver",
        target_id: input.driverId,
        reminder_type: "24h_before",
        scheduled_for: driver24h,
        requires_response: false,
      });
    }

    if (isFuture(driver60m)) {
      rows.push({
        advance_booking_id: input.advanceBookingId,
        target_type: "driver",
        target_id: input.driverId,
        reminder_type: "1h_before",
        scheduled_for: driver60m,
        requires_response: true,
      });
    }

    if (isFuture(driver30m)) {
      rows.push({
        advance_booking_id: input.advanceBookingId,
        target_type: "driver",
        target_id: input.driverId,
        reminder_type: "30m_before",
        scheduled_for: driver30m,
        requires_response: true,
      });
    }

    if (isFuture(driver10m)) {
      rows.push({
        advance_booking_id: input.advanceBookingId,
        target_type: "driver",
        target_id: input.driverId,
        reminder_type: "10m_before",
        scheduled_for: driver10m,
        requires_response: true,
      });
    }
  }

  if (rows.length === 0) {
    return { ok: true, created: 0 };
  }

  const supabase = supabaseAdmin();
  const { error } = await supabase.from("advance_booking_reminders").insert(rows);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, created: rows.length };
}