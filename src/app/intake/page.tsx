import IntakeForm from "@/components/intake-form";
import SiteFooter from "@/components/site-footer";
export default async function IntakePage({ searchParams }: { searchParams: Promise<{ pregnancy?: string }> }) {
  const params = await searchParams;
  return <div className="intake-shell">
    <header><a className="brand brand-link" href="/">Shelfie</a></header>
    <main><IntakeForm initialPregnancy={params.pregnancy === "1"} /></main>
    <SiteFooter />
  </div>;
}
