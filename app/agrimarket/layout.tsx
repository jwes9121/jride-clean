import AgrimarketFarmerLoginLink from "./AgrimarketFarmerLoginLink";
import AgrimarketNativeShellCleanup from "./AgrimarketNativeShellCleanup";

export default function AgrimarketLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AgrimarketFarmerLoginLink />
      <AgrimarketNativeShellCleanup />
    </>
  );
}
