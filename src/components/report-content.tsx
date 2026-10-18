import type { IngredientAnalysis } from "@/lib/ingredients/analyze";
import { REPORT_DISCLAIMER, UNVERIFIED_INGREDIENT, type CompletedReport } from "@/lib/report";
import { skinProfileLabels } from "@/lib/skin-profile";

function IngredientLine({ item }: { item: IngredientAnalysis }) {
  return <>
    <h3>{item.labelName}</h3>
    {item.match === "unmatched" ? <>
      <p className="review-label">{UNVERIFIED_INGREDIENT}</p>
      <p>Its role and cautions are unknown.</p>
    </> : <p>{item.explanation}</p>}
  </>;
}

export default function ReportContent({ report }: { report: CompletedReport }) {
  const { analysis } = report;
  const drying = analysis.ingredients.filter(item => item.alcoholBucket === "drying");
  const fatty = analysis.ingredients.filter(item => item.alcoholBucket === "fatty");
  const modes = [
    { title: "Pregnancy & nursing mode", on: analysis.modes.pregnancy, kind: "pregnancy_nursing" },
    { title: "GLP-1 sensitive-skin mode", on: analysis.modes.glp1, kind: "sensitive_skin" },
  ] as const;
  return <article className="report-content">
    <header className="report-intro">
      <p className="report-eyebrow">Your free first report</p>
      <h1>Your shelf, explained.</h1>
      <p className="form-intro">One product. {analysis.ingredients.length} ingredients, in the order printed on your label.</p>
      <p className="report-disclaimer">{REPORT_DISCLAIMER}</p>
      {analysis.unmatched.length > 0 && <div className="review-notice">
        <h2>Some ingredients need review.</h2>
        <p>We’ve kept the names as read. Missing explanations and cautions have not been filled in.</p>
      </div>}
    </header>

    {analysis.skinProfile && <section className="report-section" aria-labelledby="your-skin-profile">
      <h2 id="your-skin-profile">For the skin you described</h2>
      <p>{skinProfileLabels(analysis.skinProfile).join(" · ") || "No skin type or concerns selected."}</p>
      {analysis.skinProfile.note && <p>Your note: {analysis.skinProfile.note}</p>}
      <ul>{analysis.skinGuidance?.map((note, index) => <li key={index}>{note}</li>)}</ul>
      <p className="form-help">These are general ingredient cautions based on your choices. Your note is saved as you wrote it; it is not a diagnosis or a medical assessment.</p>
    </section>}

    <section className="report-section" aria-labelledby="every-ingredient">
      <h2 id="every-ingredient">Every ingredient</h2>
      <ol className="report-ingredients">{analysis.ingredients.map((item, index) => <li key={index}>
        <span className="ingredient-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <div><IngredientLine item={item} /></div>
      </li>)}</ol>
    </section>

    <section className="report-section" aria-labelledby="drying-alcohols">
      <h2 id="drying-alcohols">Drying alcohols</h2>
      <p>These can leave skin feeling dry. The amount and the whole formula matter.</p>
      {drying.length ? <ul className="report-detail-list">{drying.map((item, index) => <li key={index}><IngredientLine item={item} /><p className="report-tag">Flagged as drying</p></li>)}</ul>
        : <p className="report-empty">No drying alcohols identified among the ingredients we could verify.</p>}
    </section>

    <section className="report-section" aria-labelledby="fatty-alcohols">
      <h2 id="fatty-alcohols">Fatty alcohols</h2>
      <p>These help soften skin and give moisturizers their creamy feel.</p>
      {fatty.length ? <ul className="report-detail-list">{fatty.map((item, index) => <li key={index}><IngredientLine item={item} /><p className="report-tag">Moisturizer</p></li>)}</ul>
        : <p className="report-empty">No fatty alcohols identified among the ingredients we could verify.</p>}
    </section>

    {modes.map(mode => {
      const flagged = analysis.ingredients.flatMap(item => item.flags.filter(flag => flag.kind === mode.kind).map(flag => ({ name: item.labelName, message: flag.message })));
      return <section className="report-section" key={mode.kind} aria-labelledby={mode.kind}>
        <div className="report-section-heading"><h2 id={mode.kind}>{mode.title}</h2><span className="report-tag">{mode.on ? "On" : "Off"}</span></div>
        {!mode.on ? <p className="report-empty">This mode was off for this report.</p> : <>
          <p>{mode.kind === "pregnancy_nursing" ? "Pregnancy and nursing guidance can differ. These flags are prompts for a conversation with your doctor." : "Gentle cautions for skin that feels sensitive. These do not indicate a GLP-1 medication interaction."}</p>
          {flagged.length ? <ul className="report-detail-list">{flagged.map((flag, index) => <li key={index}><h3>{flag.name}</h3><p>{flag.message}</p></li>)}</ul>
            : <p className="report-empty">No matching mode flags in our knowledge base. Ingredient names alone do not establish suitability.</p>}
        </>}
      </section>;
    })}

    <aside className="report-notes" aria-label="About this report">
      <p>Ingredient names alone do not show how the finished product will feel or perform.</p>
      <p>This completed report is saved for your verified email. Reopening it does not use another report.</p>
      <details><summary>References</summary><ul>{Object.values(analysis.sources).map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}</ul></details>
    </aside>
  </article>;
}
