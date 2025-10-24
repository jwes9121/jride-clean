[System.IO.Directory]::CreateDirectory("$root\app\api\auth\[...nextauth]") | Out-Null
$route = @'
export { GET, POST } from "../../../auth-impl";
'@
[System.IO.File]::WriteAllText("$root\app\api\auth\[...nextauth]\route.ts", $route, $utf8)
