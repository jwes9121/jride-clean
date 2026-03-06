#requires -Version 5.1
<#
PATCH JRIDE WEB: verification upload route use Supabase session
PS5-safe, ASCII-only

Fixes:
- removes custom jride_pax_at cookie auth
- uses Supabase session cookies instead

Target:
app/api/public/passenger/verification/upload/route.ts
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference="Stop"

function Fail($m){throw $m}

function ReadText($p){
  if(!(Test-Path $p)){Fail "Missing $p"}
  return [IO.File]::ReadAllText($p)
}

function WriteText($p,$c){
  $enc=New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($p,$c,$enc)
}

$path="$ProjRoot\app\api\public\passenger\verification\upload\route.ts"

Write-Host "Patching $path"

$c=ReadText $path

# replace imports
$c=$c -replace 'import \{ createClient as createAnon \} from "@supabase/supabase-js";','import { createClient } from "@/utils/supabase/server";'
$c=$c -replace 'import \{ createClient as createAdmin \} from "@supabase/supabase-js";',''

# remove anon/admin clients
$c=$c -replace 'function anonClient\([\s\S]*?\}\n',''
$c=$c -replace 'function adminClient\([\s\S]*?\}\n',''

# replace auth block
$old='const at = req.cookies.get\("jride_pax_at"\)\?\.value \|\| ""[\s\S]*?const passengerId = data.user.id;'
$new=@'
const supabase = createClient();
const { data: userRes, error: userErr } = await supabase.auth.getUser();
const user = userRes?.user;

if (userErr || !user?.id) {
  return NextResponse.json({ ok:false, error:"Not signed in" },{status:401});
}

const passengerId = user.id;
'@

$c=[regex]::Replace($c,$old,$new)

# replace admin storage client with same client
$c=$c -replace 'const admin = adminClient\(\);','const admin = supabase;'

WriteText $path $c

Write-Host "Patch complete."