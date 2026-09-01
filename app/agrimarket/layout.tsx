import AgrimarketFarmerLoginLink from "./AgrimarketFarmerLoginLink";

export default function AgrimarketLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AgrimarketFarmerLoginLink />
    </>
  );
}
