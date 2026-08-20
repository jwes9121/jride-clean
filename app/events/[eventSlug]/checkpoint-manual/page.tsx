"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type CheckpointInfo = {
  id: string;
  name: string;
  number: number;
  sortOrder: number;
};

type SearchResult = {
  attendeeId: string;
  fullName: string;
  registrationNumber: string;
  mobileMasked: string | null;
  groupValue: string | null;
  attendanceStatus: string | null;
  isDisqualified: boolean;
  disqualificationReason: string | null;
  alreadyRecorded: boolean;
  recordedAt: string | null;
};

type ManualResponse = {
  success: boolean;
  reason?: string;
  message?: string;
  eventStatus?: string;
  station?: {
    id: string;
    name: string;
  };
  checkpoint?: CheckpointInfo;
  results?: SearchResult[];
  duplicate?: boolean;
  passedAt?: string | null;
  attendee?: {
    id: string;
    fullName: string;
    registrationNumber: string;
    attendanceStatus: string | null;
  };
};

const TOKEN_PREFIX = "jrst_";

function tokenKey(eventSlug: string) {
  return `jride_event_checkpoint_scanner_token_${eventSlug}`;
}

function validToken(value: string) {
  return (
    value.startsWith(TOKEN_PREFIX) &&
    value.length > TOKEN_PREFIX.length
  );
}

function formatTime(value: string | null | undefined) {
  if (!value) return "";

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

const reasonOptions = [
  {
    value: "qr_unreadable",
    label: "QR cannot be read",
  },
  {
    value: "pass_link_unavailable",
    label: "Event Pass link cannot be retrieved",
  },
  {
    value: "no_phone",
    label: "Participant has no phone/device",
  },
  {
    value: "assisted_identity_verification",
    label: "Identity verified using event records",
  },
  {
    value: "other",
    label: "Other verified reason",
  },
];

export default function ManualCheckpointPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [tokenLoaded, setTokenLoaded] =
    React.useState(false);
  const [stationToken, setStationToken] =
    React.useState("");
  const [setupInput, setSetupInput] =
    React.useState("");
  const [stationName, setStationName] =
    React.useState("");
  const [checkpoint, setCheckpoint] =
    React.useState<CheckpointInfo | null>(null);
  const [eventStatus, setEventStatus] =
    React.useState("");
  const [query, setQuery] = React.useState("");
  const [results, setResults] =
    React.useState<SearchResult[]>([]);
  const [selectedId, setSelectedId] =
    React.useState("");
  const [reason, setReason] =
    React.useState("qr_unreadable");
  const [note, setNote] = React.useState("");
  const [loading, setLoading] =
    React.useState(false);
  const [message, setMessage] =
    React.useState("");
  const [tone, setTone] =
    React.useState<
      "info" | "success" | "warning" | "error"
    >("info");

  const selected =
    results.find(
      (row) => row.attendeeId === selectedId
    ) || null;

  React.useEffect(() => {
    let stored = "";

    try {
      stored =
        window.localStorage.getItem(
          tokenKey(eventSlug)
        ) || "";
    } catch {}

    if (validToken(stored)) {
      setStationToken(stored);
    }

    setTokenLoaded(true);
  }, [eventSlug]);

  React.useEffect(() => {
    if (!stationToken) return;

    void validateStation();
  }, [stationToken]);

  function clearStoredToken() {
    try {
      window.localStorage.removeItem(
        tokenKey(eventSlug)
      );
    } catch {}

    setStationToken("");
    setCheckpoint(null);
    setStationName("");
  }

  async function request(
    url: string,
    options?: RequestInit
  ) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options?.headers || {}),
        "X-Event-Station-Token": stationToken,
      },
      cache: "no-store",
    });

    const payload =
      (await response.json()) as ManualResponse;

    if (
      response.status === 401 ||
      payload.reason === "station_auth_required"
    ) {
      clearStoredToken();
      throw new Error(
        payload.message ||
          "Checkpoint station token is invalid, expired, or revoked."
      );
    }

    if (!response.ok || !payload.success) {
      throw new Error(
        payload.message ||
          "Checkpoint request failed."
      );
    }

    return payload;
  }

  async function validateStation() {
    setLoading(true);
    setMessage("");

    try {
      const payload = await request(
        `/api/events/${encodeURIComponent(
          eventSlug
        )}/checkpoint-manual?q=`
      );

      setStationName(
        payload.station?.name || ""
      );
      setCheckpoint(payload.checkpoint || null);
      setEventStatus(payload.eventStatus || "");
      setTone("info");
      setMessage(
        `Manual fallback ready for ${
          payload.checkpoint?.name ||
          "this checkpoint"
        }.`
      );
    } catch (caught) {
      setTone("error");
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Station validation failed."
      );
    } finally {
      setLoading(false);
    }
  }

  function saveToken() {
    const value = setupInput.trim();

    if (!validToken(value)) {
      setTone("error");
      setMessage(
        'Checkpoint token must begin with "jrst_".'
      );
      return;
    }

    try {
      window.localStorage.setItem(
        tokenKey(eventSlug),
        value
      );
    } catch {
      setTone("error");
      setMessage(
        "Could not save the checkpoint token on this device."
      );
      return;
    }

    setSetupInput("");
    setStationToken(value);
  }

  async function searchParticipants(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (query.trim().length < 2) {
      setTone("warning");
      setMessage(
        "Enter at least 2 characters of a name, pass number, ticket number, or mobile number."
      );
      return;
    }

    setLoading(true);
    setSelectedId("");
    setMessage("");

    try {
      const payload = await request(
        `/api/events/${encodeURIComponent(
          eventSlug
        )}/checkpoint-manual?q=${encodeURIComponent(
          query.trim()
        )}`
      );

      const nextResults = payload.results || [];

      setResults(nextResults);
      setStationName(
        payload.station?.name || stationName
      );
      setCheckpoint(
        payload.checkpoint || checkpoint
      );
      setEventStatus(
        payload.eventStatus || eventStatus
      );
      setTone(
        nextResults.length > 0
          ? "info"
          : "warning"
      );
      setMessage(
        nextResults.length > 0
          ? `${nextResults.length} matching participant${
              nextResults.length === 1
                ? ""
                : "s"
            } found.`
          : "No matching participant found. Check the spelling or use the registration/ticket number."
      );
    } catch (caught) {
      setResults([]);
      setTone("error");
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Participant search failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function recordManually() {
    if (!selected || !checkpoint) {
      setTone("warning");
      setMessage(
        "Select one participant before recording."
      );
      return;
    }

    if (selected.isDisqualified) {
      setTone("error");
      setMessage(
        selected.disqualificationReason ||
          "This participant is not eligible for checkpoint recording."
      );
      return;
    }

    if (
      selected.attendanceStatus !== "checked_in"
    ) {
      setTone("warning");
      setMessage(
        "Gate attendance is required first. Send this participant to the Gate Scanner or Help Desk Manual Check-In, then search again."
      );
      return;
    }

    if (
      reason === "other" &&
      note.trim().length < 3
    ) {
      setTone("warning");
      setMessage(
        "Enter a short note for Other."
      );
      return;
    }

    const confirmed = window.confirm(
      `Confirm ${checkpoint.name} for ${selected.fullName} (${selected.registrationNumber})?`
    );

    if (!confirmed) return;

    setLoading(true);
    setMessage("");

    try {
      const payload = await request(
        `/api/events/${encodeURIComponent(
          eventSlug
        )}/checkpoint-manual`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            attendeeId: selected.attendeeId,
            reason,
            note: note.trim(),
          }),
        }
      );

      setTone(
        payload.duplicate
          ? "warning"
          : "success"
      );
      setMessage(
        `${payload.message || "Checkpoint recorded."}${
          payload.passedAt
            ? ` Time: ${formatTime(
                payload.passedAt
              )}.`
            : ""
        }`
      );

      setResults((current) =>
        current.map((row) =>
          row.attendeeId === selected.attendeeId
            ? {
                ...row,
                alreadyRecorded: true,
                recordedAt:
                  payload.passedAt ||
                  row.recordedAt,
              }
            : row
        )
      );
      setSelectedId("");
      setReason("qr_unreadable");
      setNote("");
    } catch (caught) {
      setTone("error");
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Manual checkpoint recording failed."
      );
    } finally {
      setLoading(false);
    }
  }

  const messageClass =
    tone === "success"
      ? "border-emerald-600 bg-emerald-950/50 text-emerald-200"
      : tone === "warning"
      ? "border-amber-600 bg-amber-950/50 text-amber-100"
      : tone === "error"
      ? "border-red-600 bg-red-950/50 text-red-200"
      : "border-slate-700 bg-slate-900 text-slate-300";

  if (!tokenLoaded) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-white">
        Loading checkpoint station...
      </main>
    );
  }

  if (!stationToken) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <section className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            JRide Events Checkpoint
          </p>
          <h1 className="mt-3 text-3xl font-black">
            Manual Checkpoint Setup
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Enter the token issued for this Start or Finish device. The same token authorizes both QR scanning and manual fallback for only its assigned checkpoint.
          </p>

          <input
            type="password"
            value={setupInput}
            onChange={(event) =>
              setSetupInput(event.target.value)
            }
            placeholder="jrst_..."
            autoComplete="off"
            className="mt-5 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 font-mono outline-none focus:border-cyan-300"
          />

          <button
            type="button"
            onClick={saveToken}
            className="mt-4 w-full rounded-2xl bg-cyan-400 px-5 py-4 font-black text-slate-950"
          >
            Save Checkpoint Token
          </button>

          {message ? (
            <p className={`mt-4 rounded-2xl border p-4 text-sm font-bold ${messageClass}`}>
              {message}
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <section className="mx-auto max-w-4xl">
        <div className="rounded-3xl border border-cyan-500/40 bg-slate-900 p-6 shadow-2xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
                Manual Checkpoint Fallback
              </p>
              <h1 className="mt-2 text-3xl font-black">
                {checkpoint?.name ||
                  "Validating checkpoint..."}
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                Station: {stationName || "-"} | Event status: {eventStatus || "-"}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={`/events/${eventSlug}/checkpoint-scanner`}
                className="rounded-xl border border-amber-400 px-4 py-3 text-sm font-black text-amber-300"
              >
                Back to QR Scanner
              </a>
              <button
                type="button"
                onClick={clearStoredToken}
                className="rounded-xl border border-slate-600 px-4 py-3 text-sm font-black text-slate-300"
              >
                Reset Token
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-amber-600 bg-amber-950/30 p-4 text-sm leading-6 text-amber-100">
            Use this only when the participant is physically present but the Event Pass QR cannot be scanned or retrieved. Search and verify the correct person before confirming. Manual and QR records use the same checkpoint-passage record.
          </div>

          {message ? (
            <div className={`mt-4 rounded-2xl border p-4 text-sm font-bold ${messageClass}`}>
              {message}
            </div>
          ) : null}
        </div>

        <form
          onSubmit={searchParticipants}
          className="mt-5 rounded-3xl border border-slate-800 bg-slate-900 p-6"
        >
          <label className="text-sm font-black text-slate-200">
            Find participant by name, B2FR/pass number, FR/SP ticket number, or mobile
          </label>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(event) =>
                setQuery(event.target.value)
              }
              placeholder="Example: Albit Takinan, B2FR-000034, FR-344, or 0910..."
              className="min-w-0 flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 outline-none focus:border-cyan-300"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-2xl bg-cyan-400 px-6 py-4 font-black text-slate-950 disabled:opacity-50"
            >
              {loading ? "Working..." : "Search"}
            </button>
          </div>
        </form>

        {results.length > 0 ? (
          <div className="mt-5 grid gap-3">
            {results.map((row) => {
              const selectedRow =
                row.attendeeId === selectedId;

              return (
                <button
                  key={row.attendeeId}
                  type="button"
                  onClick={() =>
                    setSelectedId(row.attendeeId)
                  }
                  className={`rounded-3xl border p-5 text-left transition ${
                    selectedRow
                      ? "border-cyan-300 bg-cyan-950/40"
                      : "border-slate-800 bg-slate-900 hover:border-slate-600"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-2xl font-black">
                        {row.fullName}
                      </p>
                      <p className="mt-1 font-mono text-sm font-bold text-slate-400">
                        {row.registrationNumber}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        {row.groupValue || "-"}
                        {row.mobileMasked
                          ? ` | Mobile ${row.mobileMasked}`
                          : ""}
                        {` | ${
                          row.attendanceStatus ===
                          "checked_in"
                            ? "Checked in"
                            : "Not checked in"
                        }`}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {row.alreadyRecorded ? (
                        <span className="rounded-full bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800">
                          ALREADY RECORDED
                        </span>
                      ) : null}
                      {row.isDisqualified ? (
                        <span className="rounded-full bg-red-100 px-3 py-2 text-xs font-black text-red-800">
                          NOT ELIGIBLE
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {row.recordedAt ? (
                    <p className="mt-3 text-sm font-bold text-emerald-300">
                      Recorded at {formatTime(row.recordedAt)}
                    </p>
                  ) : null}

                  {row.disqualificationReason ? (
                    <p className="mt-3 text-sm font-bold text-red-300">
                      {row.disqualificationReason}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {selected ? (
          <div className="mt-5 rounded-3xl border border-amber-500/50 bg-slate-900 p-6">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
              Confirm Manual Record
            </p>
            <h2 className="mt-2 text-2xl font-black">
              {selected.fullName}
            </h2>
            <p className="mt-1 font-mono text-slate-400">
              {selected.registrationNumber}
            </p>

            {selected.attendanceStatus !== "checked_in" ? (
              <p className="mt-5 rounded-2xl border border-amber-500 bg-amber-950/40 p-4 text-sm font-black text-amber-100">
                NOT CHECKED IN: record gate attendance first. Start/Finish encoding is blocked until the participant is checked in.
              </p>
            ) : null}

            <label className="mt-5 block text-sm font-bold text-slate-200">
              Reason
              <select
                value={reason}
                onChange={(event) =>
                  setReason(event.target.value)
                }
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4"
              >
                {reasonOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-4 block text-sm font-bold text-slate-200">
              Note {reason === "other" ? "(required)" : "(optional)"}
              <input
                value={note}
                onChange={(event) =>
                  setNote(event.target.value)
                }
                maxLength={250}
                placeholder="Short operational note"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4"
              />
            </label>

            <button
              type="button"
              onClick={() => void recordManually()}
              disabled={
                loading ||
                selected.isDisqualified ||
                selected.attendanceStatus !==
                  "checked_in"
              }
              className="mt-5 w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-slate-950 disabled:opacity-50"
            >
              {selected.alreadyRecorded
                ? `Confirm Existing ${
                    checkpoint?.name ||
                    "Checkpoint"
                  } Record`
                : `Record ${
                    checkpoint?.name ||
                    "Checkpoint"
                  } Manually`}
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}