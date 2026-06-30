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

export async function dryRunPostingEngine(input: PostingEngineInput) {
  const financeEventId = s(input.financeEventId);
  if (!financeEventId) {
    return { ok: false, error: "finance_event_id_required" };
  }

  const eventRes = await input.adminSb
    .from("finance_events")
    .select("*")
    .eq("id", financeEventId)
    .maybeSingle();

  if (eventRes.error) {
    return { ok: false, error: "event_read_failed", message: eventRes.error.message };
  }

  const event = eventRes.data;
  if (!event) {
    return { ok: false, error: "event_not_found" };
  }

  const effectiveDate = eventEffectiveDate(event, input.asOfDate);
  const effectiveIso = effectiveDate.toISOString();

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

  if (ruleRes.error) {
    return { ok: false, error: "rule_read_failed", message: ruleRes.error.message };
  }

  const rule = ruleRes.data;
  if (!rule) {
    return {
      ok: false,
      error: "no_rule_match",
      finance_event_id: financeEventId,
      event_type: event.event_type,
      effective_at: effectiveIso,
    };
  }

  const linesRes = await input.adminSb
    .from("finance_posting_rule_lines")
    .select("id,line_no,account_id,side,amount_source,memo_template")
    .eq("posting_rule_id", rule.id)
    .order("line_no", { ascending: true });

  if (linesRes.error) {
    return { ok: false, error: "rule_lines_read_failed", message: linesRes.error.message };
  }

  const ruleLines = Array.isArray(linesRes.data) ? linesRes.data : [];
  if (ruleLines.length < 2) {
    return { ok: false, error: "rule_lines_missing", posting_rule_id: rule.id };
  }

  const proposedLines: ProposedLine[] = [];

  for (const line of ruleLines) {
    const amount = pickPayloadAmount(event.payload, line.amount_source);
    if (amount === null) {
      return {
        ok: false,
        error: "amount_source_missing",
        amount_source: line.amount_source,
        posting_rule_id: rule.id,
      };
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

  const debit = proposedLines
    .filter((line) => line.side === "debit")
    .reduce((sum, line) => sum + line.amount, 0);

  const credit = proposedLines
    .filter((line) => line.side === "credit")
    .reduce((sum, line) => sum + line.amount, 0);

  const roundedDebit = Math.round(debit * 100) / 100;
  const roundedCredit = Math.round(credit * 100) / 100;

  if (roundedDebit !== roundedCredit) {
    return {
      ok: false,
      error: "journal_unbalanced",
      debit: roundedDebit,
      credit: roundedCredit,
      posting_rule_id: rule.id,
    };
  }

  return {
    ok: true,
    dry_run: true,
    finance_event_id: financeEventId,
    event_type: event.event_type,
    effective_at: effectiveIso,
    posting_rule: {
      id: rule.id,
      version_no: rule.version_no,
      description: rule.description,
    },
    totals: {
      debit: roundedDebit,
      credit: roundedCredit,
    },
    proposed_lines: proposedLines,
  };
}
