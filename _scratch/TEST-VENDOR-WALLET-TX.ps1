# TEST-VENDOR-WALLET-TX.ps1
$ErrorActionPreference="Stop"

$base = "http://localhost:3000"
$vendorId = "11111111-1111-1111-1111-111111111111"

try {
  $res = Invoke-RestMethod -Method GET -Uri "$base/api/admin/wallet/transactions?kind=vendor&id=$vendorId&limit=10"
  "[RESPONSE] 200"
  $res | ConvertTo-Json -Depth 10
} catch {
  "[RESPONSE] HTTP error:"
  if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $raw = $sr.ReadToEnd()
    $sr.Close()
    $raw
  } else {
    $_.Exception.Message
  }
}
