const contactEmail = "";

export default function SiteFooter({ disclaimer = "Cosmetic information only — not medical advice." }: { disclaimer?: string }) {
  return <footer className="site-footer">
    <div className="support-contact" aria-label="Contact Shelfie">
      <p className="support-heading">Questions or feedback?</p>
      <div className="support-links">
        {contactEmail && <a href={`mailto:${contactEmail}?subject=Shelfie%20feedback`}>Email: {contactEmail}</a>}
        <a href="tel:+15612557285">Call: 561-255-7285</a>
      </div>
    </div>
    <p className="footer-disclaimer">{disclaimer}</p>
  </footer>;
}
