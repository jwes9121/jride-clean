param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"
Write-Host "== PATCH JRIDE: Verify submit uses /upload + timeouts (V1.2 / PS5-safe char-code brace matcher) =="

$target = Join-Path $ProjRoot "app\verify\page.tsx"
if (!(Test-Path -LiteralPath $target)) {
  throw "Target not found: $target"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("page.tsx.bak.VERIFY_UPLOAD_TIMEOUT_V1_2.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

function Find-FunctionRangeByBraceMatch {
  param(
    [Parameter(Mandatory=$true)][string]$Content,
    [Parameter(Mandatory=$true)][string]$Needle
  )

  $start = $Content.IndexOf($Needle)
  if ($start -lt 0) { return $null }

  $braceOpen = $Content.IndexOf("{", $start)
  if ($braceOpen -lt 0) { throw "Found needle but no '{' after it: $Needle" }

  # char codes to avoid quoting/backtick issues in PS source
  $CH_SLASH     = [char]47   # /
  $CH_STAR      = [char]42   # *
  $CH_BSLASH    = [char]92   # \
  $CH_SQUOTE    = [char]39   # '
  $CH_DQUOTE    = [char]34   # "
  $CH_BTICK     = [char]96   # `
  $CH_LF        = [char]10   # \n
  $CH_LBRACE    = [char]123  # {
  $CH_RBRACE    = [char]125  # }

  $i = $braceOpen
  $depth = 0

  $inS = $false   # single-quote string
  $inD = $false   # double-quote string
  $inT = $false   # template/backtick string
  $inLine = $false
  $inBlock = $false
  $escape = $false

  while ($i -lt $Content.Length) {
    $ch = $Content[$i]

    if ($inLine) {
      if ($ch -eq $CH_LF) { $inLine = $false }
      $i++
      continue
    }

    if ($inBlock) {
      if ($ch -eq $CH_STAR -and ($i + 1) -lt $Content.Length -and $Content[$i + 1] -eq $CH_SLASH) {
        $inBlock = $false
        $i += 2
        continue
      }
      $i++
      continue
    }

    if ($inS -or $inD -or $inT) {
      if ($escape) {
        $escape = $false
        $i++
        continue
      }
      if ($ch -eq $CH_BSLASH) {
        $escape = $true
        $i++
        continue
      }
      if ($inS -and $ch -eq $CH_SQUOTE) { $inS = $false; $i++; continue }
      if ($inD -and $ch -eq $CH_DQUOTE) { $inD = $false; $i++; continue }
      if ($inT -and $ch -eq $CH_BTICK)  { $inT = $false; $i++; continue }

      $i++
      continue
    }

    # comment start?
    if ($ch -eq $CH_SLASH -and ($i + 1) -lt $Content.Length) {
      $n = $Content[$i + 1]
      if ($n -eq $CH_SLASH) { $inLine = $true; $i += 2; continue }
      if ($n -eq $CH_STAR)  { $inBlock = $true; $i += 2; continue }
    }

    # string start?
    if ($ch -eq $CH_SQUOTE) { $inS = $true; $i++; continue }
    if ($ch -eq $CH_DQUOTE) { $inD = $true; $i++; continue }
    if ($ch -eq $CH_BTICK)  { $inT = $true; $i++; continue }

    # brace counting
    if ($ch -eq $CH_LBRACE) { $depth++ }
    elseif ($ch -eq $CH_RBRACE) {
      $depth--
      if ($depth -eq 0) {
        return @{
          StartIndex = $start
          EndInclusive = $i
        }
      }
    }

    $i++
  }

  throw "Unbalanced braces while scanning: $Needle"
}

# Ensure helpers exist (skip if already inserted by V1)
if ($txt -notmatch "function fetchWithTimeout\(") {
  $anchor = "  const locked = useMemo(() => isLocked(current?.status || null), [current?.status]);"
  if ($txt.IndexOf($anchor) -lt 0) { throw "Could not locate locked useMemo anchor." }

  $helperBlock = @'

  // Network guard: never let UI hang forever
  async function fetchWithTimeout(input: RequestInfo, init: RequestInit | undefined, ms: number) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(input, { ...(init || {}), signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }

  async function uploadOne(kind: "id_front" | "selfie", file: File) {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);

    const res = await fetchWithTimeout("/api/public/passenger/verification/upload", { method: "POST", body: fd }, 60000);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      throw new Error(String(j?.error || "Upload failed"));
    }
    if (!j?.path) throw new Error("Upload failed: missing path");
    return String(j.path);
  }
'@

  $txt = $txt.Replace($anchor, $anchor + $helperBlock)
  Write-Host "[OK] Inserted helpers."
} else {
  Write-Host "[OK] Helpers already present."
}

$needle = "async function handleSubmit"
$r = Find-FunctionRangeByBraceMatch -Content $txt -Needle $needle
if ($null -eq $r) { throw "Could not find '$needle' in file." }

$startIndex = [int]$r.StartIndex
$endInclusive = [int]$r.EndInclusive

$newHandle = @'
async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!authed || !userId) {
      setError("You are not signed in. Please sign in first.");
      return;
    }

    if (locked) {
      setMessage("Already submitted. Please wait for review.");
      return;
    }

    if (!fullName.trim()) {
      setError("Full name is required.");
      return;
    }
    if (!town.trim()) {
      setError("Town is required.");
      return;
    }
    if (!idFrontFile) {
      setError("Please choose an ID front photo.");
      return;
    }
    if (!selfieFile) {
      setError("Please choose a selfie holding your ID.");
      return;
    }

    setSubmitting(true);
    setMessage("Submitting verification…");

    try {
      // 1) Upload files via dedicated endpoint (service role)
      const id_front_path = await uploadOne("id_front", idFrontFile);
      const selfie_with_id_path = await uploadOne("selfie", selfieFile);

      // 2) Write DB row via request endpoint (authenticated/RLS-safe)
      const res = await fetchWithTimeout(
        "/api/public/passenger/verification/request",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            full_name: fullName.trim(),
            town: town.trim(),
            id_front_path,
            selfie_with_id_path,
          }),
        },
        60000
      );

      const j: any = await res.json().catch(async () => {
        const t = await res.text().catch(() => "");
        return { ok: false, error: t || "Unknown error" };
      });

      if (!res.ok || !j?.ok) {
        setError(String(j?.error || "Submit failed"));
        setMessage("");
        return;
      }

      // If backend responds with "Already approved"/etc, show it
      if (j?.message) {
        setMessage(String(j.message));
      } else {
        setMessage("Submitted. Please wait for review.");
      }

      await refresh();
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (msg.toLowerCase().includes("abort")) {
        setError("Submit timed out. Please try again (network/upload delay).");
      } else {
        setError("Submit error: " + msg);
      }
      setMessage("");
    } finally {
      setSubmitting(false);
    }
  }
'@

$before = $txt.Substring(0, $startIndex)
$after = $txt.Substring($endInclusive + 1)
$txt2 = $before + $newHandle + $after

Set-Content -LiteralPath $target -Value $txt2 -Encoding UTF8
Write-Host "[OK] Replaced handleSubmit() via brace-match."
Write-Host "[OK] Wrote: $target"
Write-Host "Done."