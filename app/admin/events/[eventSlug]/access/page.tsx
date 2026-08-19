"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type Checkpoint = {
  checkpointId: string;
  checkpointName: string;
  checkpointNo: number;
  sortOrder: number;
};

type CommandResponse = {
  success: boolean;
  event?: {
    title: string;
    slug: string;
    eventDate?: string | null;
  };
  checkpointSummary?: Checkpoint[];
  error?: string;
};

type IssueResponse = {
  success: boolean;
  warning?: string;
  stationToken?: string;
  station?: {
    stationTokenId: string;
    stationType: string;
    stationName: string;
    checkpointId: string | null;
    checkpointName: string | null;
    checkpointNumber: number | null;
    expiresAt: string;
  };
  error?: string;
};

function defaultExpiry(eventDate?: string | null) {
  const base = eventDate
    ? new Date(`${eventDate}T23:59:00+08:00`)
    : new Date(Date.now() + 48 * 60 * 60 * 1000);

  if (eventDate) {
    base.setDate(base.getDate() + 1);
  }

  const local = new Date(
    base.getTime() -
      base.getTimezoneOffset() * 60 * 1000
  );

  return local.toISOString().slice(0, 16);
}

function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}

export default function EventAccessPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [data, setData] =
    React.useState<CommandResponse | null>(null);
  const [loading, setLoading] =
    React.useState(true);
  const [error, setError] = React.useState("");
  const [stationType, setStationType] =
    React.useState("scanner");
  const [stationName, setStationName] =
    React.useState("");
  const [checkpointId, setCheckpointId] =
    React.useState("");
  const [expiresAt, setExpiresAt] =
    React.useState("");
  const [issuing, setIssuing] =
    React.useState(false);
  const [issued, setIssued] =
    React.useState<IssueResponse | null>(null);
  const [copyMessage, setCopyMessage] =
    React.useState("");

  React.useEffect(() => {
    if (!eventSlug) return;

    void fetch(
      `/api/events/${encodeURIComponent(
        eventSlug
      )}/command-center`,
      {
        cache: "no-store",
      }
    )
      .then(async (response) => {
        const payload =
          (await response.json()) as CommandResponse;

        if (!response.ok || !payload.success) {
          throw new Error(
            payload.error ||
              "Unable to load event access settings."
          );
        }

        setData(payload);
        setExpiresAt(
          defaultExpiry(
            payload.event?.eventDate
          )
        );
      })
      .catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load event access settings."
        );
      })
      .finally(() => setLoading(false));
  }, [eventSlug]);

  const base =
    typeof window === "undefined"
      ? "https://app.jride.net"
      : window.location.origin;
  const checkpoints =
    data?.checkpointSummary || [];

  const publicLinks = [
    ["Public Event", `${base}/events/${eventSlug}`],
    ["General Registration", `${base}/events/${eventSlug}/register`],
    ["Batch 2001 Registration", `${base}/events/${eventSlug}/register/batch-2001`],
    ["Golden Jubilarian Registration", `${base}/events/${eventSlug}/register/golden-jubilarian`],
    ["Official Course", `${base}/events/${eventSlug}/course`],
    ["Find My Event Pass / My Walk", `${base}/events/${eventSlug}/my-walk`],
  ];

  const operationalLinks = [
    ["Gate Attendance Scanner", `${base}/events/${eventSlug}/scanner`],
    ["Checkpoint QR Scanner", `${base}/events/${eventSlug}/checkpoint-scanner`],
    ["Checkpoint Manual Backup", `${base}/events/${eventSlug}/checkpoint-manual`],
    ["Attendance Wallboard", `${base}/events/${eventSlug}/attendance-display`],
    ["Raffle Projector", `${base}/events/${eventSlug}/raffle/display`],
  ];

  const adminLinks = [
    ["Event Admin Control", `${base}/admin/events/${eventSlug}`],
    ["Attendees / Help Desk", `${base}/admin/events/${eventSlug}?tab=attendees`],
    ["Live Operations", `${base}/admin/events/${eventSlug}?tab=operations`],
    ["Reports", `${base}/admin/events/${eventSlug}?tab=reports`],
    ["Raffle Control", `${base}/admin/events/${eventSlug}?tab=raffle`],
    ["Event Status", `${base}/admin/events/${eventSlug}?tab=status`],
    ["Official Course Editor", `${base}/admin/events/${eventSlug}/route-editor`],
  ];

  function linkForType(type: string) {
    if (type === "scanner") {
      return `${base}/events/${eventSlug}/scanner`;
    }

    if (type === "checkpoint") {
      return `${base}/events/${eventSlug}/checkpoint-scanner`;
    }

    return `${base}/events/${eventSlug}/attendance-display`;
  }

  async function issueToken(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setIssued(null);
    setError("");
    setCopyMessage("");

    if (stationName.trim().length < 2) {
      setError("Enter a clear station/device name.");
      return;
    }

    if (
      stationType === "checkpoint" &&
      !checkpointId
    ) {
      setError("Select the assigned checkpoint.");
      return;
    }

    setIssuing(true);

    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(
          eventSlug
        )}/stations/issue`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            stationType,
            stationName: stationName.trim(),
            checkpointId:
              stationType === "checkpoint"
                ? checkpointId
                : undefined,
            expiresAt: new Date(
              expiresAt
            ).toISOString(),
          }),
        }
      );

      const payload =
        (await response.json()) as IssueResponse;

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error ||
            "Station token issuance failed."
        );
      }

      setIssued(payload);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Station token issuance failed."
      );
    } finally {
      setIssuing(false);
    }
  }

  async function copyBundle() {
    if (!issued?.stationToken) return;

    const primaryLink = linkForType(
      issued.station?.stationType ||
        stationType
    );
    const manualLink =
      issued.station?.stationType ===
      "checkpoint"
        ? `\nManual backup: ${base}/events/${eventSlug}/checkpoint-manual`
        : "";
    const text =
      `JRide Event Assistant Access\n` +
      `Station: ${
        issued.station?.stationName ||
        stationName
      }\n` +
      `Link: ${primaryLink}${manualLink}\n` +
      `Station token: ${issued.stationToken}\n` +
      `Expires: ${
        issued.station?.expiresAt || ""
      }\n\n` +
      `Open the link on the assigned device, paste the token once, and do not share it with another device.`;

    await copyText(text);
    setCopyMessage(
      "Assistant access instructions copied."
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-white">
        Loading event access center...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <section className="mx-auto max-w-6xl">
        <div className="rounded-3xl border border-amber-400/40 bg-slate-900 p-6 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
            JRide Events Admin
          </p>
          <h1 className="mt-2 text-4xl font-black">
            Event Links &amp; Assistant Access
          </h1>
          <p className="mt-3 text-slate-300">
            {data?.event?.title || eventSlug}
          </p>
          <p className="mt-4 rounded-2xl border border-red-700 bg-red-950/40 p-4 text-sm font-bold text-red-100">
            A link alone does not grant operational access. Give each helper device its own event-scoped station token. Do not share your admin Google account or add temporary helpers as global JRide dispatchers.
          </p>

          {error ? (
            <p className="mt-4 rounded-2xl bg-red-100 p-4 font-bold text-red-800">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <LinkPanel
            title="Public Links"
            helper="Safe to share publicly"
            links={publicLinks}
          />
          <LinkPanel
            title="Operational Links"
            helper="Require a station token on the assigned device"
            links={operationalLinks}
          />
          <LinkPanel
            title="Admin Links"
            helper="Require an approved Admin/Dispatcher Google sign-in"
            links={adminLinks}
          />
        </div>

        <form
          onSubmit={issueToken}
          className="mt-5 rounded-3xl border border-cyan-500/40 bg-slate-900 p-6"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            Issue One Device Token
          </p>
          <h2 className="mt-2 text-2xl font-black">
            Batch 2001 assistant access
          </h2>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold text-slate-200">
              Task / Station Type
              <select
                value={stationType}
                onChange={(event) => {
                  setStationType(
                    event.target.value
                  );
                  setIssued(null);
                }}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4"
              >
                <option value="scanner">
                  Gate Attendance Scanner
                </option>
                <option value="checkpoint">
                  Start / Finish Checkpoint
                </option>
                <option value="projector">
                  Attendance Monitor / Projector
                </option>
              </select>
            </label>

            <label className="text-sm font-bold text-slate-200">
              Station / Device Name
              <input
                value={stationName}
                onChange={(event) =>
                  setStationName(
                    event.target.value
                  )
                }
                placeholder="Example: Batch 2001 Finish Phone 1"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4"
              />
            </label>

            {stationType === "checkpoint" ? (
              <label className="text-sm font-bold text-slate-200">
                Assigned Checkpoint
                <select
                  value={checkpointId}
                  onChange={(event) =>
                    setCheckpointId(
                      event.target.value
                    )
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4"
                >
                  <option value="">
                    Select checkpoint
                  </option>
                  {checkpoints.map((item) => (
                    <option
                      key={item.checkpointId}
                      value={item.checkpointId}
                    >
                      Checkpoint {item.checkpointNo} - {item.checkpointName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="text-sm font-bold text-slate-200">
              Token Expiry
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(event) =>
                  setExpiresAt(
                    event.target.value
                  )
                }
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={issuing}
            className="mt-5 rounded-2xl bg-cyan-400 px-6 py-4 font-black text-slate-950 disabled:opacity-50"
          >
            {issuing
              ? "Issuing Token..."
              : "Issue Event-Scoped Token"}
          </button>
        </form>

        {issued?.stationToken ? (
          <div className="mt-5 rounded-3xl border-2 border-emerald-400 bg-emerald-950/40 p-6">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
              Copy Now - Token Is Shown Once
            </p>
            <h2 className="mt-2 text-2xl font-black">
              {issued.station?.stationName}
            </h2>
            <p className="mt-3 break-all rounded-2xl bg-black p-4 font-mono text-sm text-emerald-200">
              {issued.stationToken}
            </p>
            <p className="mt-3 text-sm font-bold text-emerald-100">
              {issued.warning}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  void copyText(
                    issued.stationToken || ""
                  ).then(() =>
                    setCopyMessage(
                      "Token copied."
                    )
                  )
                }
                className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-slate-950"
              >
                Copy Token
              </button>
              <button
                type="button"
                onClick={() =>
                  void copyBundle()
                }
                className="rounded-xl border border-emerald-400 px-5 py-3 font-black text-emerald-200"
              >
                Copy Link + Setup Instructions
              </button>
            </div>
            {copyMessage ? (
              <p className="mt-3 font-bold text-emerald-200">
                {copyMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
          <p className="font-black text-white">
            Access rule
          </p>
          <p className="mt-2">
            One token per device. A Finish checkpoint token authorizes both the Finish QR Scanner and the Manual Lookup / Encode fallback on that same device. The Attendance Wallboard uses a separate Projector token. Admin pages still require an approved Google account and should remain limited to you and trusted core operators.
          </p>
        </div>
      </section>
    </main>
  );
}

function LinkPanel({
  title,
  helper,
  links,
}: {
  title: string;
  helper: string;
  links: string[][];
}) {
  const [message, setMessage] =
    React.useState("");

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-2xl font-black">
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        {helper}
      </p>
      <div className="mt-4 space-y-3">
        {links.map(([label, url]) => (
          <div
            key={url}
            className="rounded-2xl bg-slate-950 p-3"
          >
            <p className="font-bold">
              {label}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-slate-500">
              {url}
            </p>
            <div className="mt-2 flex gap-2">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-black"
              >
                Open
              </a>
              <button
                type="button"
                onClick={() =>
                  void copyText(url).then(() =>
                    setMessage(
                      `${label} copied.`
                    )
                  )
                }
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-black"
              >
                Copy
              </button>
            </div>
          </div>
        ))}
      </div>
      {message ? (
        <p className="mt-3 text-xs font-bold text-emerald-300">
          {message}
        </p>
      ) : null}
    </div>
  );
}