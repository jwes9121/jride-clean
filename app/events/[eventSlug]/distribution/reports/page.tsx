"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type BreakdownRow = {
  key: string;
  households: number;
  activeHouseholds: number;
  members: number;
  allocatedHouseholds: number;
  claimedHouseholds: number;
  cancelledHouseholds: number;
  allocatedQuantity: number;
  claimedQuantity: number;
  unclaimedHouseholds: number;
  claimCompletionPercent: number;
  quantityCompletionPercent: number;
};

type HouseholdRow = {
  beneficiaryId: string;
  beneficiaryCode: string;
  displayName: string;
  householdHeadName: string | null;
  mobileNumber: string | null;
  municipality: string | null;
  barangay: string | null;
  addressText: string | null;
  memberCount: number | null;
  beneficiaryStatus: string;
  registeredAt: string;
  entitlement: {
    id: string;
    itemName: string;
    quantity: number;
    unitLabel: string;
    claimToken: string;
    status: string;
    allocatedAt: string;
    claimedAt: string | null;
    cancelledAt: string | null;
  } | null;
  claim: {
    id: string;
    claimedQuantity: number;
    unitLabel: string;
    method: string;
    counterName: string | null;
    claimedByEmail: string;
    claimedAt: string;
    notes: string | null;
  } | null;
};

type RecentClaim = {
  claimId: string;
  beneficiaryId: string;
  beneficiaryCode: string | null;
  displayName: string;
  householdHeadName: string | null;
  municipality: string | null;
  barangay: string | null;
  claimedQuantity: number;
  unitLabel: string;
  method: string;
  counterName: string | null;
  claimedByEmail: string;
  claimedAt: string;
};

type CsvRow = Record<
  string,
  string | number
>;

type ReportsResponse = {
  success: boolean;
  reason?: string;
  message?: string;
  error?: string;
  generatedAt?: string;
  event?: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
  program?: {
    id: string;
    program_key: string;
    program_name: string;
    status: string;
  };
  summary?: {
    totalHouseholds: number;
    activeHouseholds: number;
    totalMembers: number;
    allocatedHouseholds: number;
    claimedHouseholds: number;
    unclaimedHouseholds: number;
    cancelledHouseholds: number;
    claimCompletionPercent: number;
    allocatedQuantity: number;
    claimedQuantity: number;
    unclaimedQuantity: number;
    quantityCompletionPercent: number;
    municipalityCount: number;
    barangayCount: number;
  };
  municipalityBreakdown?: BreakdownRow[];
  barangayBreakdown?: BreakdownRow[];
  largestMunicipalities?: BreakdownRow[];
  claimedHouseholds?: HouseholdRow[];
  unclaimedHouseholds?: HouseholdRow[];
  recentClaims?: RecentClaim[];
  csvRows?: CsvRow[];
};

function formatNumber(
  value: number | undefined,
  maximumFractionDigits = 0
) {
  return new Intl.NumberFormat("en-PH", {
    maximumFractionDigits,
  }).format(value || 0);
}

function formatDateTime(
  value: string | null | undefined
) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    "en-PH",
    {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }
  ).format(new Date(value));
}

function formatPercent(
  value: number | undefined
) {
  return `${formatNumber(value, 2)}%`;
}

function escapeCsvValue(
  value: string | number
) {
  const text = String(value ?? "");

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadCsv(
  rows: CsvRow[],
  fileName: string
) {
  if (!rows.length) {
    return;
  }

  const headers = Object.keys(rows[0]);

  const csv = [
    headers
      .map(escapeCsvValue)
      .join(","),
    ...rows.map((row) =>
      headers
        .map((header) =>
          escapeCsvValue(
            row[header] ?? ""
          )
        )
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8",
  });

  const url =
    URL.createObjectURL(blob);

  const anchor =
    document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

function ProgressBar({
  value,
}: {
  value: number;
}) {
  const bounded = Math.min(
    100,
    Math.max(0, value)
  );

  return (
    <div className="h-3 overflow-hidden rounded-full bg-slate-200">
      <div
        className="h-full rounded-full bg-slate-950"
        style={{
          width: `${bounded}%`,
        }}
      />
    </div>
  );
}

export default function HongaDistributionReportsPage() {
  const params = useParams<{
    eventSlug: string;
  }>();

  const eventSlug = String(
    params?.eventSlug || ""
  );

  const [data, setData] =
    React.useState<ReportsResponse | null>(
      null
    );

  const [loading, setLoading] =
    React.useState(true);

  const [error, setError] =
    React.useState("");

  const [householdQuery, setHouseholdQuery] =
    React.useState("");

  const [townQuery, setTownQuery] =
    React.useState("");

  const [activeTab, setActiveTab] =
    React.useState<
      "claimed" | "unclaimed"
    >("unclaimed");

  async function loadReport() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/events/${eventSlug}/distribution/reports`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const payload =
        (await response.json()) as ReportsResponse;

      if (
        !response.ok ||
        !payload.success
      ) {
        throw new Error(
          payload.message ||
            payload.error ||
            "Unable to load report."
        );
      }

      setData(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load report."
      );
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!eventSlug) {
      return;
    }

    void loadReport();
  }, [eventSlug]);

  const summary = data?.summary;

  const filteredMunicipalities =
    (data?.municipalityBreakdown || [])
      .filter((row) =>
        row.key
          .toLowerCase()
          .includes(
            townQuery
              .trim()
              .toLowerCase()
          )
      );

  const filteredBarangays =
    (data?.barangayBreakdown || [])
      .filter((row) =>
        row.key
          .toLowerCase()
          .includes(
            townQuery
              .trim()
              .toLowerCase()
          )
      );

  const householdRows =
    activeTab === "claimed"
      ? data?.claimedHouseholds || []
      : data?.unclaimedHouseholds || [];

  const filteredHouseholds =
    householdRows.filter((row) => {
      const normalized =
        householdQuery
          .trim()
          .toLowerCase();

      if (!normalized) {
        return true;
      }

      return [
        row.displayName,
        row.beneficiaryCode,
        row.householdHeadName,
        row.mobileNumber,
        row.municipality,
        row.barangay,
        row.addressText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });

  const csvFileName =
    `${eventSlug}-honga-distribution-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 print:bg-white print:px-0 print:py-0">
      <section className="mx-auto max-w-7xl">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl print:rounded-none print:shadow-none">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                JRide Events
              </p>

              <h1 className="mt-3 text-3xl font-black md:text-4xl">
                Honga Distribution Report
              </h1>

              <p className="mt-2 text-slate-300">
                {data?.event?.name ||
                  eventSlug}
              </p>

              {data?.generatedAt ? (
                <p className="mt-2 text-sm text-slate-400">
                  Generated{" "}
                  {formatDateTime(
                    data.generatedAt
                  )}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3 print:hidden">
              <a
                href={`/events/${eventSlug}/distribution/households`}
                className="rounded-2xl border border-slate-600 px-5 py-3 font-black"
              >
                Households
              </a>

              <a
                href={`/events/${eventSlug}/distribution/claim`}
                className="rounded-2xl border border-slate-600 px-5 py-3 font-black"
              >
                Claim Scanner
              </a>

              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    data?.csvRows || [],
                    csvFileName
                  )
                }
                disabled={
                  !data?.csvRows?.length
                }
                className="rounded-2xl bg-amber-400 px-5 py-3 font-black text-slate-950 disabled:opacity-50"
              >
                Export CSV
              </button>

              <button
                type="button"
                onClick={() =>
                  window.print()
                }
                className="rounded-2xl bg-white px-5 py-3 font-black text-slate-950"
              >
                Print Report
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 font-bold text-red-800">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 rounded-3xl bg-white p-12 text-center text-xl font-black shadow-sm">
            Loading distribution report...
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [
                  "Households",
                  summary?.totalHouseholds ??
                    0,
                ],
                [
                  "Members Represented",
                  summary?.totalMembers ??
                    0,
                ],
                [
                  "Claimed",
                  summary?.claimedHouseholds ??
                    0,
                ],
                [
                  "Unclaimed",
                  summary?.unclaimedHouseholds ??
                    0,
                ],
                [
                  "Municipalities",
                  summary?.municipalityCount ??
                    0,
                ],
                [
                  "Barangays",
                  summary?.barangayCount ??
                    0,
                ],
                [
                  "Allocated Quantity",
                  formatNumber(
                    summary?.allocatedQuantity,
                    3
                  ),
                ],
                [
                  "Released Quantity",
                  formatNumber(
                    summary?.claimedQuantity,
                    3
                  ),
                ],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    {label}
                  </p>

                  <p className="mt-3 text-4xl font-black">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                      Household Completion
                    </p>

                    <p className="mt-2 text-4xl font-black">
                      {formatPercent(
                        summary?.claimCompletionPercent
                      )}
                    </p>
                  </div>

                  <p className="text-right text-sm font-bold text-slate-500">
                    {summary?.claimedHouseholds ||
                      0}{" "}
                    of{" "}
                    {(summary?.claimedHouseholds ||
                      0) +
                      (summary?.unclaimedHouseholds ||
                        0)}
                  </p>
                </div>

                <div className="mt-5">
                  <ProgressBar
                    value={
                      summary?.claimCompletionPercent ||
                      0
                    }
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                      Quantity Released
                    </p>

                    <p className="mt-2 text-4xl font-black">
                      {formatPercent(
                        summary?.quantityCompletionPercent
                      )}
                    </p>
                  </div>

                  <p className="text-right text-sm font-bold text-slate-500">
                    {formatNumber(
                      summary?.claimedQuantity,
                      3
                    )}{" "}
                    released
                    <br />
                    {formatNumber(
                      summary?.unclaimedQuantity,
                      3
                    )}{" "}
                    remaining
                  </p>
                </div>

                <div className="mt-5">
                  <ProgressBar
                    value={
                      summary?.quantityCompletionPercent ||
                      0
                    }
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
              <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                <input
                  value={townQuery}
                  onChange={(event) =>
                    setTownQuery(
                      event.target.value
                    )
                  }
                  placeholder="Filter municipality or barangay"
                  className="rounded-2xl border border-slate-300 px-4 py-3 font-semibold outline-none focus:border-slate-950"
                />

                <button
                  type="button"
                  onClick={() =>
                    void loadReport()
                  }
                  className="rounded-2xl border border-slate-300 px-5 py-3 font-black"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Municipality Ranking
                  </p>

                  <h2 className="mt-2 text-2xl font-black">
                    Largest Participating Towns
                  </h2>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-slate-950 text-left text-white">
                      <tr>
                        <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                          Town
                        </th>
                        <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                          Households
                        </th>
                        <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                          Members
                        </th>
                        <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                          Claimed
                        </th>
                        <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                          Rate
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredMunicipalities.map(
                        (row) => (
                          <tr
                            key={row.key}
                            className="border-t border-slate-200"
                          >
                            <td className="px-4 py-4 font-black">
                              {row.key}
                            </td>

                            <td className="px-4 py-4">
                              {row.households}
                            </td>

                            <td className="px-4 py-4">
                              {row.members}
                            </td>

                            <td className="px-4 py-4">
                              {
                                row.claimedHouseholds
                              }
                            </td>

                            <td className="px-4 py-4 font-black">
                              {formatPercent(
                                row.claimCompletionPercent
                              )}
                            </td>
                          </tr>
                        )
                      )}

                      {filteredMunicipalities.length ===
                      0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-10 text-center font-bold text-slate-500"
                          >
                            No municipality data.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Barangay Ranking
                  </p>

                  <h2 className="mt-2 text-2xl font-black">
                    Household Participation by Barangay
                  </h2>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-slate-950 text-left text-white">
                      <tr>
                        <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                          Barangay
                        </th>
                        <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                          Households
                        </th>
                        <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                          Members
                        </th>
                        <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                          Claimed
                        </th>
                        <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                          Rate
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredBarangays.map(
                        (row) => (
                          <tr
                            key={row.key}
                            className="border-t border-slate-200"
                          >
                            <td className="px-4 py-4 font-black">
                              {row.key}
                            </td>

                            <td className="px-4 py-4">
                              {row.households}
                            </td>

                            <td className="px-4 py-4">
                              {row.members}
                            </td>

                            <td className="px-4 py-4">
                              {
                                row.claimedHouseholds
                              }
                            </td>

                            <td className="px-4 py-4 font-black">
                              {formatPercent(
                                row.claimCompletionPercent
                              )}
                            </td>
                          </tr>
                        )
                      )}

                      {filteredBarangays.length ===
                      0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-10 text-center font-bold text-slate-500"
                          >
                            No barangay data.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Household Status
                  </p>

                  <h2 className="mt-2 text-2xl font-black">
                    Claimed and Unclaimed Households
                  </h2>
                </div>

                <div className="flex flex-wrap gap-3 print:hidden">
                  <button
                    type="button"
                    onClick={() =>
                      setActiveTab(
                        "unclaimed"
                      )
                    }
                    className={`rounded-2xl px-5 py-3 font-black ${
                      activeTab ===
                      "unclaimed"
                        ? "bg-slate-950 text-white"
                        : "border border-slate-300 bg-white"
                    }`}
                  >
                    Unclaimed
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setActiveTab(
                        "claimed"
                      )
                    }
                    className={`rounded-2xl px-5 py-3 font-black ${
                      activeTab ===
                      "claimed"
                        ? "bg-slate-950 text-white"
                        : "border border-slate-300 bg-white"
                    }`}
                  >
                    Claimed
                  </button>
                </div>
              </div>

              <div className="border-b border-slate-200 p-5 print:hidden">
                <input
                  value={householdQuery}
                  onChange={(event) =>
                    setHouseholdQuery(
                      event.target.value
                    )
                  }
                  placeholder="Search household, code, town, barangay, mobile, or head"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-semibold outline-none focus:border-slate-950"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-slate-950 text-left text-white">
                    <tr>
                      <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                        Household
                      </th>
                      <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                        Location
                      </th>
                      <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                        Members
                      </th>
                      <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                        Quantity
                      </th>
                      <th className="px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
                        Status Time
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredHouseholds.map(
                      (row) => (
                        <tr
                          key={row.beneficiaryId}
                          className="border-t border-slate-200 align-top"
                        >
                          <td className="px-4 py-4">
                            <p className="font-black">
                              {row.displayName}
                            </p>

                            <p className="mt-1 font-mono text-xs font-bold text-slate-500">
                              {row.beneficiaryCode}
                            </p>

                            {row.householdHeadName ? (
                              <p className="mt-2 text-sm text-slate-600">
                                Head:{" "}
                                {
                                  row.householdHeadName
                                }
                              </p>
                            ) : null}
                          </td>

                          <td className="px-4 py-4 text-sm">
                            <p className="font-bold">
                              {[
                                row.barangay,
                                row.municipality,
                              ]
                                .filter(Boolean)
                                .join(", ") ||
                                "-"}
                            </p>

                            {row.mobileNumber ? (
                              <p className="mt-2 text-slate-500">
                                {row.mobileNumber}
                              </p>
                            ) : null}
                          </td>

                          <td className="px-4 py-4 text-2xl font-black">
                            {row.memberCount ??
                              "-"}
                          </td>

                          <td className="px-4 py-4 font-black">
                            {row.entitlement
                              ? `${formatNumber(
                                  row.entitlement
                                    .quantity,
                                  3
                                )} ${
                                  row
                                    .entitlement
                                    .unitLabel
                                }`
                              : "-"}
                          </td>

                          <td className="px-4 py-4 text-sm">
                            <p className="font-black uppercase">
                              {row.entitlement
                                ?.status || "none"}
                            </p>

                            <p className="mt-2 text-slate-500">
                              {activeTab ===
                              "claimed"
                                ? formatDateTime(
                                    row.claim
                                      ?.claimedAt
                                  )
                                : formatDateTime(
                                    row
                                      .entitlement
                                      ?.allocatedAt
                                  )}
                            </p>
                          </td>
                        </tr>
                      )
                    )}

                    {filteredHouseholds.length ===
                    0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-10 text-center font-bold text-slate-500"
                        >
                          No households found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Recent Activity
                </p>

                <h2 className="mt-2 text-2xl font-black">
                  Latest Pahing Claims
                </h2>
              </div>

              <div className="divide-y divide-slate-200">
                {(data?.recentClaims || []).map(
                  (claim) => (
                    <div
                      key={claim.claimId}
                      className="grid gap-3 p-5 md:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <p className="font-black">
                          {claim.displayName}
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          {[
                            claim.barangay,
                            claim.municipality,
                          ]
                            .filter(Boolean)
                            .join(", ") ||
                            "Location unspecified"}
                        </p>

                        <p className="mt-2 text-sm text-slate-600">
                          {formatNumber(
                            claim.claimedQuantity,
                            3
                          )}{" "}
                          {claim.unitLabel}
                          {" | "}
                          {claim.method}
                          {" | "}
                          {claim.counterName ||
                            "No counter"}
                        </p>
                      </div>

                      <div className="text-left md:text-right">
                        <p className="font-bold">
                          {formatDateTime(
                            claim.claimedAt
                          )}
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          {
                            claim.claimedByEmail
                          }
                        </p>
                      </div>
                    </div>
                  )
                )}

                {(data?.recentClaims || [])
                  .length === 0 ? (
                  <div className="p-10 text-center font-bold text-slate-500">
                    No claims recorded yet.
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
