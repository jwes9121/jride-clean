import MeetingRoomClient from "./MeetingRoomClient";

export default function MeetingRoomPage({ params }: { params: { meetingId: string } }) {
  return <MeetingRoomClient meetingId={params.meetingId} />;
}
