"use client";

import { useState } from "react";
import SiteFooter from "@/components/site-footer";

export default function Home() {
  const [pregnancyMode, setPregnancyMode] = useState(false);

  return (
    <div className="front-door">
      <header className="brand">Shelfie</header>
      <main className="welcome">
        <h1>Know what&apos;s really on your shelf.</h1>
        <p className="intro">Snap photos of your products. Get a plain-English report on what&apos;s inside them.</p>
        <button
          type="button"
          className="mode-chip"
          aria-pressed={pregnancyMode}
          onClick={() => setPregnancyMode(!pregnancyMode)}
        >
          <span className="mode-indicator" aria-hidden="true">{pregnancyMode ? "✓" : ""}</span>
          Pregnancy &amp; nursing mode
        </button>
        <a className="primary-button" href={`/intake?pregnancy=${pregnancyMode ? "1" : "0"}`}>Get my free first report</a>
      </main>
      <SiteFooter />
    </div>
  );
}
