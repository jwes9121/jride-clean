@"
export { handlers as GET, handlers as POST } from "@/auth";
"@ | Out-File -LiteralPath "app\api\auth\debug\route.ts" -Encoding utf8 -Force
