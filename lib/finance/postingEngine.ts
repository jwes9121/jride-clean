type SupabaseLike = {
  from: (table: string) => any;
};

type PostingEngineInput = {
  adminSb: SupabaseLike;
  financeEventId: string;
  asOfDate?: string | null;
};

type ProposedLine = {
  line_no: number;
  account_id: string;
  side: "debit" | "credit";
  amount_source: string;
  amount: number;
  memo: string | null;
};

function s(v: any) {
  return String(v ?? "").trim();
}

function n(v: any) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function pickPayloadAmount(payload: any, key: string) {
  if (!payload || typeof payload !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return null;
  const amount = n(payload[key]);
  if (amount <= 0) return null;
  return amount;
}

function eventEffectiveDate(event: any, override?: string | null) {
  const candidate =
    s(override) ||
    s(event?.payload?.event_at) ||
    s(event?.payload?.completed_at) ||
    s(event?.payload?.created_at) ||
    s(event?.created_at);

  const d = new Date(candidate);
  if (!Number.isFinite(d.getTime())) return new Date();
  return d;
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function journalNo(event: any) {
  const datePart = String(event?.created_at || new Date().toISOString()).slice(0, 10).replace(/-/g, "");
  const idPart = String(event?.id || "").replace(/-/g, "").slice(0, 10).toUpperCase();
  return `JE-${datePart}-${idPart}`;
}

async function buildPostingPreview(input: PostingEngineInput) {
  const financeEventId = s(input.financeEventId);
  if (!financeEventId) return { ok: false, error: "finance_event_id_required" };

  const eventRes = await input.adminSb.from("finance_events").select("*").eq("id", financeEventId).maybeSingle();
  if (eventRes.error) return { ok: false, error: "event_read_failed", message: eventRes.error.message };

  const event = eventRes.data;
  if (!event) return { ok: false, error: "event_not_found" };

  if (event.journal_entry_id) {
    return { ok: false, error: "event_already_posted", journal_entry_id: event.journal_entry_id };
  }

  const existingJournalRes = await input.adminSb
    .from("finance_journal_entries")
    .select("id,status")
    .eq("source_event_id", financeEventId)
    .limit(1)
    .maybeSingle();

  if (existingJournalRes.error) {
    return { ok: false, error: "existing_journal_check_failed", message: existingJournalRes.error.message };
  }

  if (existingJournalRes.data?.id) {
    return { ok: false, error: "source_event_already_has_journal", journal_entry_id: existingJournalRes.data.id };
  }

  const effectiveDate = eventEffectiveDate(event, input.asOfDate);
  const effectiveIso = effectiveDate.toISOString();

  const periodRes = await input.adminSb
    .from("finance_periods")
    .select("id,status,period_start,period_end")
    .eq("company_id", event.company_id)
    .lte("period_start", ymd(effectiveDate))
    .gte("period_end", ymd(effectiveDate))
    .in("status", ["open"])
    .limit(1)
    .maybeSingle();

  if (periodRes.error) return { ok: false, error: "period_read_failed", message: periodRes.error.message };
  if (!periodRes.data?.id) return { ok: false, error: "open_period_not_found", effective_at: effectiveIso };

  const ruleRes = await input.adminSb
    .from("finance_posting_rules")
    .select("*")
    .eq("company_id", event.company_id)
    .eq("event_type", event.event_type)
    .eq("status", "active")
    .lte("effective_from", effectiveIso)
    .or(`effective_to.is.null,effective_to.gt.${effectiveIso}`)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ruleRes.error) return { ok: false, error: "rule_read_failed", message: ruleRes.error.message };

  const rule = ruleRes.data;
  if (!rule) {
    return { ok: false, error: "no_rule_match", finance_event_id: financeEventId, event_type: event.event_type, effective_at: effectiveIso };
  }

  const linesRes = await input.adminSb
    .from("finance_posting_rule_lines")
    .select("id,line_no,account_id,side,amount_source,memo_template")
    .eq("posting_rule_id", rule.id)
    .order("line_no", { ascending: true });

  if (linesRes.error) return { ok: false, error: "rule_lines_read_failed", message: linesRes.error.message };

  const ruleLines = Array.isArray(linesRes.data) ? linesRes.data : [];
  if (ruleLines.length < 2) return { ok: false, error: "rule_lines_missing", posting_rule_id: rule.id };

  const proposedLines: ProposedLine[] = [];

  for (const line of ruleLines) {
    const amount = pickPayloadAmount(event.payload, line.amount_source);
    if (amount === null) {
      return { ok: false, error: "amount_source_missing", amount_source: line.amount_source, posting_rule_id: rule.id };
    }

    proposedLines.push({
      line_no: Number(line.line_no),
      account_id: String(line.account_id),
      side: line.side,
      amount_source: String(line.amount_source),
      amount,
      memo: line.memo_template || null,
    });
  }

  const debit = proposedLines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amount, 0);
  const credit = proposedLines.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amount, 0);

  const roundedDebit = Math.round(debit * 100) / 100;
  const roundedCredit = Math.round(credit * 100) / 100;

  if (roundedDebit !== roundedCredit) {
    return { ok: false, error: "journal_unbalanced", debit: roundedDebit, credit: roundedCredit, posting_rule_id: rule.id };
  }

  return {
    ok: true,
    finance_event_id: financeEventId,
    event,
    period: periodRes.data,
    effective_at: effectiveIso,
    posting_rule: { id: rule.id, version_no: rule.version_no, description: rule.description },
    totals: { debit: roundedDebit, credit: roundedCredit },
    proposed_lines: proposedLines,
  };
}

export async function dryRunPostingEngine(input: PostingEngineInput) {
  const preview = await buildPostingPreview(input);
  if (!preview.ok) return preview;

  return {
    ok: true,
    dry_run: true,
    finance_event_id: preview.finance_event_id,
    event_type: preview.event.event_type,
    effective_at: preview.effective_at,
    posting_rule: preview.posting_rule,
    totals: preview.totals,
    proposed_lines: preview.proposed_lines,
  };
}

export async function postFinanceEvent(input: PostingEngineInput & { postedBy?: string | null }) {
  const preview = await buildPostingPreview(input);
  if (!preview.ok) return preview;

  const adminSb = input.adminSb;
  const event = preview.event;
  const now = new Date().toISOString();

  const postingRule = preview.posting_rule;
  if (!postingRule) {
    return { ok: false, error: "posting_rule_missing", finance_event_id: event.id };
  }

  const runInsert = await adminSb
    .from("finance_posting_runs")
    .insert({
      company_id: event.company_id,
      finance_event_id: event.id,
      posting_rule_id: postingRule.id,
      posting_rule_version_no: postingRule.version_no,
      status: "started",
      retry_count: 0,
      started_at: now,
      created_by: input.postedBy || null,
    })
    .select("id")
    .single();

  if (runInsert.error) {
    return { ok: false, error: "posting_run_create_failed", message: runInsert.error.message };
  }

  const postingRunId = runInsert.data.id;

  try {
    const journalInsert = await adminSb
      .from("finance_journal_entries")
      .insert({
        company_id: event.company_id,
        period_id: preview.period.id,
        journal_no: journalNo(event),
        journal_date: ymd(new Date(preview.effective_at)),
        status: "draft",
        description: `${event.event_type} from ${event.source_type || "finance_event"}`,
        town: event.town || null,
        source_event_id: event.id,
        created_by: input.postedBy || null,
        business_unit_id: event.business_unit_id || null,
        location_id: event.location_id || null,
      })
      .select("id,journal_no,status")
      .single();

    if (journalInsert.error) throw new Error("journal_create_failed: " + journalInsert.error.message);

    const journal = journalInsert.data;

    const lineRows = preview.proposed_lines.map((line: ProposedLine) => ({
      company_id: event.company_id,
      journal_entry_id: journal.id,
      account_id: line.account_id,
      line_no: line.line_no,
      debit: line.side === "debit" ? line.amount : 0,
      credit: line.side === "credit" ? line.amount : 0,
      memo: line.memo,
      town: event.town || null,
      created_by: input.postedBy || null,
      business_unit_id: event.business_unit_id || null,
      location_id: event.location_id || null,
    }));

    const lineInsert = await adminSb.from("finance_journal_lines").insert(lineRows);
    if (lineInsert.error) throw new Error("journal_lines_create_failed: " + lineInsert.error.message);

    const postJournal = await adminSb
      .from("finance_journal_entries")
      .update({
        status: "posted",
        posted_by: input.postedBy || null,
      })
      .eq("id", journal.id)
      .select("id,journal_no,status,posted_at")
      .single();

    if (postJournal.error) throw new Error("journal_post_failed: " + postJournal.error.message);

    const updateEvent = await adminSb
      .from("finance_events")
      .update({
        status: "processed",
        journal_entry_id: journal.id,
        processed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", event.id);

    if (updateEvent.error) throw new Error("finance_event_update_failed: " + updateEvent.error.message);

    const updateRun = await adminSb
      .from("finance_posting_runs")
      .update({
        status: "success",
        journal_entry_id: journal.id,
        finished_at: new Date().toISOString(),
      })
      .eq("id", postingRunId);

    if (updateRun.error) throw new Error("posting_run_success_update_failed: " + updateRun.error.message);

    return {
      ok: true,
      posted: true,
      finance_event_id: event.id,
      posting_run_id: postingRunId,
      journal_entry_id: journal.id,
      journal_no: journal.journal_no,
      totals: preview.totals,
    };
  } catch (e: any) {
    await adminSb
      .from("finance_posting_runs")
      .update({
        status: "failed",
        failure_message: String(e?.message || e || "posting_failed"),
        finished_at: new Date().toISOString(),
      })
      .eq("id", postingRunId);

    await adminSb
      .from("finance_events")
      .update({
        status: "failed",
        last_error: String(e?.message || e || "posting_failed"),
      })
      .eq("id", event.id);

    return { ok: false, error: "posting_failed", message: String(e?.message || e || "posting_failed"), posting_run_id: postingRunId };
  }
}
