"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type RelationshipType = "biological" | "adoptive" | "step";

type ParentRelationship = {
  relationshipId: string;
  parentPersonId: string;
  parentName: string;
  parentNickname: string | null;
  parentFamilyId: string | null;
  parentFamilyName: string | null;
  locationText: string | null;
  locationBucket: string | null;
  relationshipType: RelationshipType;
  createdAt: string;
};

type ReplacementCandidate = {
  candidateId: string;
  fullName: string;
  nickname: string | null;
  locationText: string | null;
  locationBucket: string | null;
  matchScope: "CURRENT_FAMILY" | "OTHER_FAMILY";
  organizationalFamily: {
    id: string;
    name: string | null;
  } | null;
  similarityScore: number;
  existingParentOfChild: boolean;
  cycleWouldBeCreated: boolean;
  quickParentDecision: string;
  replacementAllowed: boolean;
  replacementBlockReason: string | null;
};

type ParentRelationshipsResponse = {
  success: boolean;
  error?: string;
  child?: {
    id: string;
    fullName: string;
    familyId: string | null;
  };
  biologicalParentCount?: number;
  relationships?: ParentRelationship[];
  candidates?: ReplacementCandidate[];
};

type MutationResponse = {
  success: boolean;
  resultCode?: string;
  error?: string;
  message?: string;
};

type PendingAction =
  | {
      kind: "replace";
      relationship: ParentRelationship;
      candidate: ReplacementCandidate;
    }
  | {
      kind: "change_type";
      relationship: ParentRelationship;
      relationshipType: RelationshipType;
    }
  | {
      kind: "remove";
      relationship: ParentRelationship;
    };

function relationshipTypeLabel(value: RelationshipType) {
  if (value === "biological") return "Biological";
  if (value === "adoptive") return "Adoptive";
  return "Step";
}

function locationLabel(
  locationText: string | null,
  locationBucket: string | null
) {
  if (locationText && locationBucket) {
    return locationText === locationBucket
      ? locationText
      : `${locationText} - ${locationBucket}`;
  }

  return locationText || locationBucket || "Location not recorded";
}

function familyLabel(relationship: ParentRelationship) {
  return (
    relationship.parentFamilyName ||
    relationship.parentFamilyId ||
    "No organizational family"
  );
}

export default function ParentRelationshipCorrectionPage() {
  const params = useParams<{ familyId: string }>();
  const familyId = params.familyId;

  const [childPersonId, setChildPersonId] = React.useState("");
  const [childName, setChildName] = React.useState("");
  const [biologicalParentCount, setBiologicalParentCount] =
    React.useState(0);
  const [relationships, setRelationships] = React.useState<
    ParentRelationship[]
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [mutationError, setMutationError] =
    React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [replaceRelationshipId, setReplaceRelationshipId] =
    React.useState<string | null>(null);
  const [replaceQuery, setReplaceQuery] = React.useState("");
  const [replacementCandidates, setReplacementCandidates] =
    React.useState<ReplacementCandidate[]>([]);
  const [searchingCandidates, setSearchingCandidates] =
    React.useState(false);
  const [candidateError, setCandidateError] =
    React.useState<string | null>(null);

  const [typeDraftByRelationshipId, setTypeDraftByRelationshipId] =
    React.useState<Record<string, RelationshipType>>({});

  const [pendingAction, setPendingAction] =
    React.useState<PendingAction | null>(null);

  React.useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setChildPersonId(String(query.get("personId") || "").trim());
  }, []);

  const loadRelationships = React.useCallback(async () => {
    if (!familyId || !childPersonId) {
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const query = new URLSearchParams({
        childPersonId,
      });

      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(
          familyId
        )}/parent-relationships?${query.toString()}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data =
        (await response.json()) as ParentRelationshipsResponse;

      if (!response.ok || !data.success || !data.child) {
        setLoadError(
          data.error || "Failed to load parent relationships."
        );
        setRelationships([]);
        return;
      }

      const nextRelationships = data.relationships || [];

      setChildName(data.child.fullName);
      setBiologicalParentCount(data.biologicalParentCount || 0);
      setRelationships(nextRelationships);
      setTypeDraftByRelationshipId(
        Object.fromEntries(
          nextRelationships.map((relationship) => [
            relationship.relationshipId,
            relationship.relationshipType,
          ])
        )
      );
    } catch (caught) {
      setLoadError(
        caught instanceof Error
          ? caught.message
          : "Failed to load parent relationships."
      );
      setRelationships([]);
    } finally {
      setLoading(false);
    }
  }, [childPersonId, familyId]);

  React.useEffect(() => {
    if (!childPersonId) {
      setLoading(false);
      return;
    }

    void loadRelationships();
  }, [childPersonId, loadRelationships]);

  async function searchReplacementCandidates() {
    const queryText = replaceQuery.trim();

    if (queryText.length < 2) {
      setCandidateError("Enter at least 2 characters.");
      setReplacementCandidates([]);
      return;
    }

    setSearchingCandidates(true);
    setCandidateError(null);
    setReplacementCandidates([]);

    try {
      const query = new URLSearchParams({
        childPersonId,
        q: queryText,
      });

      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(
          familyId
        )}/parent-relationships?${query.toString()}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data =
        (await response.json()) as ParentRelationshipsResponse;

      if (!response.ok || !data.success) {
        setCandidateError(
          data.error || "Failed to search replacement parents."
        );
        return;
      }

      setReplacementCandidates(data.candidates || []);
    } catch (caught) {
      setCandidateError(
        caught instanceof Error
          ? caught.message
          : "Failed to search replacement parents."
      );
    } finally {
      setSearchingCandidates(false);
    }
  }

  function openReplacement(relationship: ParentRelationship) {
    setReplaceRelationshipId(relationship.relationshipId);
    setReplaceQuery("");
    setReplacementCandidates([]);
    setCandidateError(null);
    setPendingAction(null);
    setMutationError(null);
    setSuccess(null);
  }

  function closeReplacement() {
    setReplaceRelationshipId(null);
    setReplaceQuery("");
    setReplacementCandidates([]);
    setCandidateError(null);
  }

  async function confirmPendingAction() {
    if (!pendingAction || !childPersonId) return;

    setSaving(true);
    setMutationError(null);
    setSuccess(null);

    try {
      const relationship = pendingAction.relationship;
      let response: Response;

      if (pendingAction.kind === "remove") {
        response = await fetch(
          `/api/events/family-reunions/${encodeURIComponent(
            familyId
          )}/parent-relationships`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              childPersonId,
              relationshipId: relationship.relationshipId,
              expectedParentPersonId: relationship.parentPersonId,
              confirmRemove: true,
            }),
          }
        );
      } else if (pendingAction.kind === "replace") {
        response = await fetch(
          `/api/events/family-reunions/${encodeURIComponent(
            familyId
          )}/parent-relationships`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              operation: "replace_parent",
              childPersonId,
              relationshipId: relationship.relationshipId,
              expectedParentPersonId: relationship.parentPersonId,
              replacementParentPersonId:
                pendingAction.candidate.candidateId,
            }),
          }
        );
      } else {
        response = await fetch(
          `/api/events/family-reunions/${encodeURIComponent(
            familyId
          )}/parent-relationships`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              operation: "change_type",
              childPersonId,
              relationshipId: relationship.relationshipId,
              expectedParentPersonId: relationship.parentPersonId,
              relationshipType: pendingAction.relationshipType,
            }),
          }
        );
      }

      const data = (await response.json()) as MutationResponse;

      if (!response.ok || !data.success) {
        setMutationError(
          data.error || "Parent relationship correction failed."
        );
        return;
      }

      setSuccess(data.message || "Parent relationship updated.");
      setPendingAction(null);
      closeReplacement();
      await loadRelationships();
    } catch (caught) {
      setMutationError(
        caught instanceof Error
          ? caught.message
          : "Parent relationship correction failed."
      );
    } finally {
      setSaving(false);
    }
  }

  if (!childPersonId && !loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 text-white">
        <Link
          href={`/admin/events/family-reunions/${encodeURIComponent(
            familyId
          )}`}
          className="text-sm font-black text-amber-300"
        >
          Back to family project
        </Link>

        <div className="mt-6 rounded-3xl border border-amber-800 bg-amber-950/20 p-6">
          <h1 className="text-2xl font-black">
            Parent Relationship Correction
          </h1>
          <p className="mt-3 text-sm leading-6 text-amber-100/80">
            This correction page must be opened for a specific family
            member. Return to the family project and use Review Parent
            Relationships from the affected person.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/admin/events/family-reunions/${encodeURIComponent(
              familyId
            )}`}
            className="text-sm font-black text-amber-300"
          >
            Back to family project
          </Link>
          <h1 className="mt-3 text-3xl font-black">
            Parent Relationship Correction
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Correct the recorded parent edges for one person. Generation
            is never edited here; tree placement is recalculated from the
            genealogy graph after every correction.
          </p>
        </div>
      </div>

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-red-800 bg-red-950/20 p-4 text-sm text-red-200">
          {loadError}
        </div>
      ) : null}

      {mutationError ? (
        <div className="mt-6 rounded-2xl border border-red-800 bg-red-950/20 p-4 text-sm text-red-200">
          {mutationError}
        </div>
      ) : null}

      {success ? (
        <div className="mt-6 rounded-2xl border border-emerald-800 bg-emerald-950/20 p-4 text-sm font-bold text-emerald-200">
          {success}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">
          Loading recorded parent relationships...
        </div>
      ) : (
        <>
          <section className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
              Person Being Corrected
            </p>
            <p className="mt-2 text-xl font-black">{childName}</p>
            <p className="mt-2 text-sm text-slate-400">
              {biologicalParentCount} biological parent
              {biologicalParentCount === 1 ? "" : "s"} currently
              recorded.
            </p>
          </section>

          <section className="mt-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">
                  Recorded Parent Relationships
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Each correction targets one exact relationship row.
                  Cross-family parents remain valid genealogy links.
                </p>
              </div>
            </div>

            {relationships.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">
                No parent relationships are currently recorded for this
                person.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {relationships.map((relationship) => {
                  const typeDraft =
                    typeDraftByRelationshipId[
                      relationship.relationshipId
                    ] || relationship.relationshipType;
                  const replacementOpen =
                    replaceRelationshipId ===
                    relationship.relationshipId;

                  return (
                    <article
                      key={relationship.relationshipId}
                      className="rounded-3xl border border-slate-800 bg-slate-900 p-5"
                    >
                      <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-black">
                              {relationship.parentName}
                            </p>
                            <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-amber-300">
                              {relationshipTypeLabel(
                                relationship.relationshipType
                              )}
                            </span>
                          </div>

                          {relationship.parentNickname ? (
                            <p className="mt-1 text-sm text-slate-400">
                              "{relationship.parentNickname}"
                            </p>
                          ) : null}

                          <p className="mt-3 text-sm text-slate-400">
                            Filed under: {familyLabel(relationship)}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {locationLabel(
                              relationship.locationText,
                              relationship.locationBucket
                            )}
                          </p>

                          <p className="mt-3 font-mono text-[10px] text-slate-600">
                            Relationship ID:{" "}
                            {relationship.relationshipId}
                          </p>
                        </div>

                        <div className="space-y-3">
                          <button
                            type="button"
                            onClick={() =>
                              openReplacement(relationship)
                            }
                            className="w-full rounded-xl border border-cyan-400/30 bg-cyan-950/20 px-4 py-2.5 text-sm font-black text-cyan-200"
                          >
                            Replace Parent
                          </button>

                          <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
                            <label className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                              Relationship Type
                            </label>
                            <select
                              value={typeDraft}
                              onChange={(event) =>
                                setTypeDraftByRelationshipId(
                                  (current) => ({
                                    ...current,
                                    [relationship.relationshipId]:
                                      event.target
                                        .value as RelationshipType,
                                  })
                                )
                              }
                              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                            >
                              <option value="biological">
                                Biological
                              </option>
                              <option value="adoptive">
                                Adoptive
                              </option>
                              <option value="step">Step</option>
                            </select>

                            <button
                              type="button"
                              disabled={
                                typeDraft ===
                                relationship.relationshipType
                              }
                              onClick={() =>
                                setPendingAction({
                                  kind: "change_type",
                                  relationship,
                                  relationshipType: typeDraft,
                                })
                              }
                              className="mt-2 w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-black text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Review Type Change
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setPendingAction({
                                kind: "remove",
                                relationship,
                              })
                            }
                            className="w-full rounded-xl border border-red-800 bg-red-950/20 px-4 py-2.5 text-sm font-black text-red-200"
                          >
                            Review Removal
                          </button>
                        </div>
                      </div>

                      {replacementOpen ? (
                        <div className="mt-5 rounded-2xl border border-cyan-900 bg-slate-950 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-black text-cyan-200">
                                Replace {relationship.parentName}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-slate-500">
                                Search existing people across family
                                projects. The existing relationship type
                                stays{" "}
                                {relationshipTypeLabel(
                                  relationship.relationshipType
                                ).toLowerCase()}
                                .
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={closeReplacement}
                              className="text-xs font-black text-slate-400"
                            >
                              Close
                            </button>
                          </div>

                          <div className="mt-4 flex gap-2">
                            <input
                              value={replaceQuery}
                              onChange={(event) =>
                                setReplaceQuery(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void searchReplacementCandidates();
                                }
                              }}
                              placeholder="Search replacement parent..."
                              className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white"
                            />
                            <button
                              type="button"
                              disabled={searchingCandidates}
                              onClick={() =>
                                void searchReplacementCandidates()
                              }
                              className="rounded-xl border border-cyan-400/30 bg-cyan-950/20 px-4 py-2.5 text-sm font-black text-cyan-200 disabled:opacity-50"
                            >
                              {searchingCandidates
                                ? "Searching..."
                                : "Search"}
                            </button>
                          </div>

                          {candidateError ? (
                            <p className="mt-3 text-sm text-red-300">
                              {candidateError}
                            </p>
                          ) : null}

                          {replacementCandidates.length > 0 ? (
                            <div className="mt-4 space-y-2">
                              {replacementCandidates.map(
                                (candidate) => (
                                  <div
                                    key={candidate.candidateId}
                                    className="rounded-xl border border-slate-800 bg-slate-900 p-3"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div>
                                        <p className="font-black">
                                          {candidate.fullName}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">
                                          {candidate.organizationalFamily
                                            ?.name ||
                                            candidate
                                              .organizationalFamily
                                              ?.id ||
                                            "No organizational family"}
                                          {" | "}
                                          {locationLabel(
                                            candidate.locationText,
                                            candidate.locationBucket
                                          )}
                                        </p>
                                        {candidate.replacementBlockReason ? (
                                          <p className="mt-2 text-xs leading-5 text-amber-300">
                                            {
                                              candidate.replacementBlockReason
                                            }
                                          </p>
                                        ) : (
                                          <p className="mt-2 text-xs text-emerald-300">
                                            Safe to review as a
                                            replacement.
                                          </p>
                                        )}
                                      </div>

                                      <button
                                        type="button"
                                        disabled={
                                          !candidate.replacementAllowed
                                        }
                                        onClick={() =>
                                          setPendingAction({
                                            kind: "replace",
                                            relationship,
                                            candidate,
                                          })
                                        }
                                        className="rounded-lg border border-cyan-400/30 px-3 py-2 text-xs font-black text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        Review Replacement
                                      </button>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-lg font-black">Safety Rules</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
              <li>
                Parent replacement keeps the existing relationship row
                and relationship type.
              </li>
              <li>
                Biological-parent changes are protected by the database
                two-parent limit.
              </li>
              <li>
                Parent replacement is protected by the ancestry-cycle
                trigger and the unique parent-child edge constraint.
              </li>
              <li>
                Removing a relationship deletes only the exact selected
                edge. It does not delete either person.
              </li>
              <li>
                Generation remains graph-derived and is never stored or
                edited here.
              </li>
            </ul>
          </section>
        </>
      )}

      {pendingAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-xl rounded-3xl border border-slate-700 bg-slate-950 p-6 shadow-2xl">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-300">
              Confirm Parent Relationship Correction
            </p>

            {pendingAction.kind === "replace" ? (
              <>
                <h2 className="mt-3 text-xl font-black">
                  Replace {pendingAction.relationship.parentName} with{" "}
                  {pendingAction.candidate.fullName}?
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  The relationship type remains{" "}
                  {relationshipTypeLabel(
                    pendingAction.relationship.relationshipType
                  ).toLowerCase()}
                  . The existing relationship row is updated in place.
                </p>
              </>
            ) : null}

            {pendingAction.kind === "change_type" ? (
              <>
                <h2 className="mt-3 text-xl font-black">
                  Change relationship type?
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  {pendingAction.relationship.parentName}{" -> "}{childName}
                  {" will change from "}
                  {relationshipTypeLabel(
                    pendingAction.relationship.relationshipType
                  )}
                  {" to "}
                  {relationshipTypeLabel(
                    pendingAction.relationshipType
                  )}
                  .
                </p>
              </>
            ) : null}

            {pendingAction.kind === "remove" ? (
              <>
                <h2 className="mt-3 text-xl font-black text-red-200">
                  Remove this parent relationship?
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  This removes only the relationship edge from{" "}
                  {pendingAction.relationship.parentName} to {childName}.
                  Neither person will be deleted.
                </p>
              </>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => setPendingAction(null)}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-black text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => void confirmPendingAction()}
                className={`rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50 ${
                  pendingAction.kind === "remove"
                    ? "bg-red-500 text-white"
                    : "bg-amber-300 text-slate-950"
                }`}
              >
                {saving ? "Saving..." : "Confirm Correction"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
