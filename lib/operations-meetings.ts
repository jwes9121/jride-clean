export const MEETING_BUCKET = "operations-meeting-assets";

export const MEETING_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type MeetingStatus = "planned" | "live" | "ended" | "cancelled";

export type MeetingAsset = {
  id: string;
  meeting_id: string;
  kind: "image" | "pdf";
  storage_path: string;
  mime_type: string;
  original_name: string;
  caption: string;
  sort_order: number;
  created_at: string;
  signed_url?: string | null;
};

export type MeetingAttendance = {
  meeting_id: string;
  employee_id?: string | null;
  staff_email: string;
  joined_at: string;
  last_seen_at: string;
  left_at?: string | null;
  late_minutes: number;
  display_name?: string | null;
};

export type MeetingView = {
  id: string;
  title: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  required: boolean;
  participant_ids: string[];
  participant_names?: string[];
  agenda: string;
  call_url: string;
  notes: string;
  status: MeetingStatus;
  current_slide: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  version: number;
  assets: MeetingAsset[];
  attendance: MeetingAttendance[];
};

export function meetingStartMs(meeting: Pick<MeetingView, "meeting_date" | "start_time">): number {
  const value = Date.parse(`${meeting.meeting_date}T${meeting.start_time}+08:00`);
  return Number.isFinite(value) ? value : 0;
}

export function meetingStatusLabel(meeting: Pick<MeetingView, "status">): string {
  if (meeting.status === "live") return "LIVE NOW";
  if (meeting.status === "ended") return "Ended";
  if (meeting.status === "cancelled") return "Cancelled";
  return "Upcoming";
}

export function isSafeMeetingCallUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function meetingLateMinutes(
  meeting: Pick<MeetingView, "meeting_date" | "start_time">,
  joinedAtMs: number
): number {
  const start = meetingStartMs(meeting);
  if (!start || !Number.isFinite(joinedAtMs)) return 0;
  return Math.max(0, Math.floor((joinedAtMs - start) / 60000));
}
