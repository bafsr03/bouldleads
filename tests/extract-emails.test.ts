import { describe, expect, it } from "vitest";
import { cleanEmail, contactLinks, decodeCfEmail, deobfuscate, extractEmails, pickBest, scoreEmail } from "@/lib/enrich/extract-emails";

// Encode like Cloudflare does: key byte, then each char XOR key, as hex.
function cfEncode(email: string, key = 0x42) {
  return [key, ...[...email].map((c) => c.charCodeAt(0) ^ key)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("extractEmails", () => {
  it("finds mailto links, plain text, JSON-LD and Cloudflare-protected addresses", () => {
    const html = `
      <html><body>
        <a href="mailto:Info@SunriseBakery.com?subject=Hi">Email us</a>
        <p>Bookings: bookings@sunrisebakery.com</p>
        <span class="__cf_email__" data-cfemail="${cfEncode("owner@sunrisebakery.com")}">[email protected]</span>
        <script type="application/ld+json">{"email":"mailto:press@sunrisebakery.com"}</script>
        <img src="logo@2x.png">
      </body></html>`;
    const emails = extractEmails(html, "https://sunrisebakery.com").map((f) => f.email).sort();
    expect(emails).toEqual([
      "bookings@sunrisebakery.com",
      "info@sunrisebakery.com",
      "owner@sunrisebakery.com",
      "press@sunrisebakery.com",
    ]);
  });

  it("de-obfuscates [at] / (dot) styles", () => {
    expect(deobfuscate("info [at] acme [dot] com")).toBe("info@acme.com");
    expect(deobfuscate("hello(at)acme.co.uk")).toBe("hello@acme.co.uk");
    const found = extractEmails("<body>Write to: contact [at] joes-plumbing [dot] com</body>", "https://joes-plumbing.com");
    expect(found.map((f) => f.email)).toContain("contact@joes-plumbing.com");
  });

  it("rejects junk addresses", () => {
    expect(cleanEmail("noreply@acme.com")).toBeNull();
    expect(cleanEmail("you@example.com")).toBeNull();
    expect(cleanEmail("abc123@sentry.wixpress.com")).toBeNull();
    expect(cleanEmail("icon@2x.png")).toBeNull();
    expect(cleanEmail("mailto:Hello@Acme.com")).toBe("hello@acme.com");
  });

  it("decodes Cloudflare email protection", () => {
    expect(decodeCfEmail(cfEncode("a@b.co"))).toBe("a@b.co");
  });
});

describe("ranking", () => {
  it("prefers generic on-domain addresses over third-party ones", () => {
    const best = pickBest(
      [
        { email: "studio@webagency.io", source: "x", viaMailto: true },
        { email: "info@sunrisebakery.com", source: "x", viaMailto: false },
        { email: "sunrisebakery@gmail.com", source: "x", viaMailto: false },
      ],
      "sunrisebakery.com",
    );
    expect(best?.email).toBe("info@sunrisebakery.com");
  });

  it("scores same-domain above free-mail above foreign domains", () => {
    const own = scoreEmail("hello@acme.com", "acme.com", false);
    const free = scoreEmail("acme@gmail.com", "acme.com", false);
    const foreign = scoreEmail("hello@other.com", "acme.com", false);
    expect(own).toBeGreaterThan(free);
    expect(free).toBeGreaterThan(foreign);
  });
});

describe("contactLinks", () => {
  it("returns same-site contact pages first and ignores external links", () => {
    const html = `<a href="/about-us">About</a><a href="/contact">Contact</a><a href="https://facebook.com/contact">FB</a><a href="/menu.pdf">Menu</a>`;
    expect(contactLinks(html, "https://acme.com/")).toEqual(["https://acme.com/contact", "https://acme.com/about-us"]);
  });
});

describe("department addresses", () => {
  it("ranks owner-facing addresses above investor/wholesale/donation inboxes", () => {
    const best = pickBest(
      [
        { email: "investorrelations@acme.com", source: "x", viaMailto: true },
        { email: "donations@acme.com", source: "x", viaMailto: true },
        { email: "maria@acme.com", source: "x", viaMailto: false },
      ],
      "acme.com",
    );
    expect(best?.email).toBe("maria@acme.com");
  });
});
