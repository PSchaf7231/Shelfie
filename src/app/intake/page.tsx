import IntakeForm from "@/components/intake-form";
export default async function IntakePage({ searchParams }: { searchParams: Promise<{ pregnancy?: string }> }) {
  const params = await searchParams;
  return <div className="intake-shell">
    <header><a className="brand brand-link" href="/">Shelfie</a></header>
    <main><IntakeForm initialPregnancy={params.pregnancy === "1"} /></main>
    <footer>Cosmetic information only — not medical advice.</footer>
  </div>;
}
