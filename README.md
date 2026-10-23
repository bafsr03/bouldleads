# BouldLeads

Finds businesses in any area (a radius, city, region or whole country), discovers the contact email each one publishes, **audits every lead with the Bould Golden Formula** (Leads = Visibility × Conversion), and runs a **call-first** outreach loop: you call the best leads first, and anyone who doesn't pick up automatically gets a short email follow-up (day 1, 3, 5 and 12). Replies and callbacks come back to the call list.

Run it on your own computer (free, no login), or deploy it to Vercel so the whole team can use it (see **Deploy to Vercel** below).

## Quick start

```bash
npm install
npm run dev          # dashboard on http://127.0.0.1:3000 + background worker
```

Then follow the checklist on the **Overview** page:

1. **Settings**: add your company name and postal address. The law requires them in every email footer, and launching is blocked until they're set.
2. **Find leads**: search a place (e.g. "Austin, Texas" or "Portugal"), or click the map and set a radius. Pick business types from the catalog of 110+ (smoke & vape shops, barbers, dentists, contractors…), tick **All businesses**, or type any keyword to match business names (e.g. `hookah`, `bridal`). Advanced: enter an OpenStreetMap tag like `shop=tobacco`. Press **Find businesses**.
   **Must have** controls which businesses are kept: *website or email* (for email campaigns), *any contact, phone counts* (for calls), or *nothing*.
3. **Leads**: watch businesses come in. The worker visits each website and picks the best publicly listed email, then audits the business. Click a lead for its scores, talking points and call brief. You can export to CSV.
4. **Call list**: leads with a phone number in tabs by stage (*To call, Callbacks, Replied, Emailing, Call again, Booked & won, Closed*), best first, with each business's local time and the #1 issue to open with. Every call ends with one tap:
   | Button | What happens |
   |---|---|
   | **No answer** / **Voicemail** | The no-answer email follow-up starts (if the lead has a verified email) |
   | **Call back** | Pick a time; emails stop; the lead shows under *Callbacks* |
   | **Booked** / **Won** | Emails stop; the lead moves to *Booked & won* |
   | **Not interested** | Emails stop; lead closed |
   | **Wrong number** | Phone marked bad; it leaves the call list |
   | **Do not call** | Calls and emails stop for good; the email is suppressed |

   A reply to any email moves the lead to *Replied* so you call them back. **Dialer CSV** exports the list in the columns WAVV/GoHighLevel import.
5. **Places**: every search grouped by city, on a map that lights up the areas you've covered (darker where nothing was found), with lead dots by tier. Re-run or delete searches here.
6. **Leads**: filter by place, search, stage, tier and type (the URL is shareable). Select rows or **all matching**, then start emails, audit, exclude or **delete** (deleted leads don't come back when you search again).
7. **Inboxes**: connect one or more sending mailboxes on a separate domain, then click **Check DNS** for each one.
8. **Emails**: edit the *No-answer follow-up*, or create a classic campaign for leads you won't call.

Locally, keep the app running (and your Mac awake) during the send window. Hosted, a cron job does the background work every minute.

## How it works

| Stage | What happens | Cost |
|---|---|---|
| Discover | OpenStreetMap via the Overpass API (4 public mirrors with automatic failover). Large areas are split into ~28 km tiles; a tile that fails while the servers are busy is skipped and can be filled with **Retry**. Chain/franchise locations are skipped. | Free |
| Enrich | Visits the homepage plus up to 5 contact/about/impressum pages and respects robots.txt. Finds `mailto:` links, plain text, obfuscated `info [at] x [dot] com` forms, Cloudflare-protected addresses and JSON-LD. Ranks addresses on the business's own domain first. | Free |
| Verify | Checks syntax, filters disposable domains, and confirms the domain accepts mail (MX record). It doesn't do SMTP probing, which gets IPs blocklisted. | Free |
| Audit | **Top-3 check (Competitor Check spec v2):** rank for "service in city" in the top 20, the top 3 compared (rating, reviews, category), a case A–G with the one line to say, website flags, and the call order (lib/check). **Visibility (0–20):** seven checks measured against the top 3 (category, reviews, map pack, one market) plus profile claimed, branded search and last month's leads, answered on the call. **Conversion (0–100):** the homepage against the build standard (tap-to-call/WhatsApp, quote form or booking, mobile, reviews on site, title, schema, analytics, freshness, speed). Dead and parked domains are detected. The result is the verdict (Launch now / Launch + visibility / Visibility first), the pattern (Rubio, Kilowash…), a priority tier (A/B/C/not a fit) and talking points. | Free (Google parts use your key) |
| Send | SMTP from your inboxes, rotated, with per-inbox daily caps, warm-up, a sending window and random 90–240 s gaps. Plain text plus simple HTML, with no tracking pixels. | Your inboxes |
| Track | IMAP every 5 minutes. A reply stops follow-ups. "Remove"/"unsubscribe" replies and bounces go on a permanent do-not-contact list. | Free |

Optional add-ons (both off by default):
- **Google Places** (recommended): a much bigger lead source than OpenStreetMap outside the US/EU, plus ratings, review counts and map rankings for the audit. In Google Cloud, enable *Places API (New)*, create a key and paste it in Settings. Searching both sources merges duplicates into one lead. Usage per month, which BouldLeads tracks and by default stops at the free allowance:
  - Lead searches: 1,000 free requests, 20 businesses each (~20,000 businesses).
  - Profile lookups for OSM leads: 1,000 free.
  - Map-ranking checks: always free.
  Beyond that, Google charges about $0.02–0.035 per request.
- **AI first lines** (`{{personal_line}}`): one sentence written from the business's own website text. You can use local **Ollama** (free: `brew install ollama && ollama pull llama3.2`) or **Claude** (your Anthropic API key; fractions of a cent per email).

## Deploy to Vercel (for the team)

Step-by-step guide: **[docs/SETUP-VERCEL.md](docs/SETUP-VERCEL.md)**. Jake's daily guide: **[docs/JAKE.md](docs/JAKE.md)**.

The hosted app uses **Turso** (hosted SQLite, free tier) instead of the local file, and background work runs from `/api/cron/tick` instead of the local worker. Everyone signs in with their own name and password.

1. **Database**: in Vercel → *Storage* → *Marketplace*, add **Turso** and connect it to the project. It sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. (Or create a database at turso.tech and set both yourself.) Tables are created on first request.
2. **Logins**: for each person run `npm run hash-password -- Jake 'their-password'` and join the lines with commas:
   `APP_USERS=Brian:scrypt.…,Jake:scrypt.…`
3. **Secrets**: set `BOULDLEADS_SECRET`, `SESSION_SECRET` and `CRON_SECRET` to long random strings (`openssl rand -base64 32`). Never change `BOULDLEADS_SECRET` later: it decrypts the saved inbox passwords. Optional: `GOOGLE_PLACES_API_KEY`. See `.env.example`.
4. **Deploy**: `vercel deploy --prod` (or connect the Git repository).
5. **Every-minute background tasks**: Vercel's free (Hobby) plan only runs cron jobs once a day (`vercel.json` has that as a fallback). Create a free job at [cron-job.org](https://cron-job.org) that calls `https://<your-app>.vercel.app/api/cron/tick?key=<CRON_SECRET>&budget=25` every minute (`budget` keeps each run inside cron-job.org's 30-second wait). On Vercel Pro you can change the schedule in `vercel.json` to `* * * * *` instead.
6. Optional: `npm run copy-to-hosted` copies your local leads, calls and searches into Turso (see the guide).
7. Sign in, set the company name, address and **time zone** in Settings, and add the sending inboxes.

Note: Vercel's Hobby plan is meant for non-commercial use; a business using it day to day should be on Pro.

## Reaching 10,000 emails: the deliverability checklist

Sending 10,000 cold emails isn't safe on free infrastructure. Free Gmail accounts and free ESP tiers (Brevo, SendGrid, SES, Resend) ban cold outreach. Blasting from your main domain will get it blacklisted. The cheapest professional setup is:

1. **Buy a secondary domain** (~$10/yr), e.g. `bouldhq-mail.com`. Redirect its website to your main site.
2. **Create 3–10 inboxes** on it: Zoho Mail Lite (~$1/user/mo, includes SMTP/IMAP) or Google Workspace.
3. **Set up DNS**: SPF, DKIM (your mail provider gives you the record) and DMARC (`_dmarc` TXT `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`). The Inboxes page checks all four records.
4. **Warm up.** Each inbox starts at 10/day and adds 5/day up to its cap (default 40). These defaults are editable.
5. **Volume math.** 5 inboxes × 40/day = 200/day, so ~50 weekdays for 10k. 10 inboxes = 400/day, so ~25 weekdays.
6. **Keep bounce rate under 2%.** If a campaign's bounce rate climbs, pause it and raise the minimum email confidence.

## Compliance (built in, not optional)

- Every email gets a footer with your company, postal address and an opt-out line. A `List-Unsubscribe` header is also added.
- Opt-outs and bounces are suppressed forever. The do-not-contact list is checked before every single send, and no address is ever emailed by two campaigns.
- The app stores the page where each email was found. It only uses addresses the business published itself.
- Country guidance appears when you search and when you launch:
  - **US (CAN-SPAM):** allowed with an opt-out.
  - **Canada (CASL):** only conspicuously published, role-relevant addresses.
  - **UK/EU (GDPR/PECR):** legitimate interest, corporate addresses, easy opt-out.
  - **Germany and Austria:** leads are excluded by default, because cold B2B email there generally needs prior consent.
- This is practical guidance, not legal advice.

## Testing without sending anything

```bash
brew install mailpit && mailpit      # SMTP on :1025, inbox UI on http://localhost:8025
```

Add an inbox with the **Mailpit (local testing)** preset. Every email is caught locally.

```bash
npm test             # unit + integration tests (vitest)
```

## Project layout

```
app/                    Next.js pages (dashboard) and app/api/* route handlers
lib/discovery/          Nominatim geocoding, Overpass tiling/queries, Google Places, categories
lib/enrich/             website crawler, email extraction & ranking, MX verification
lib/audit/              Golden Formula audit: site checks, Google research, scoring (pure, tested), call brief
lib/outreach/           templates (spintax + merge tags), scheduler, SMTP sending, IMAP sync, suppression
lib/compliance/         per-country rules
lib/calls.ts            call dispositions → actions, lead stages, the no-answer follow-up
lib/tasks/tick.ts       one bounded pass of background work: send → search → enrich → audit → IMAP
lib/auth.ts, proxy.ts   team logins (APP_USERS) with signed session cookies
worker/index.ts         local worker: runs the tick in a loop
app/api/cron/tick       hosted worker: the same tick, called every minute
data/                   local SQLite database + encryption key (git-ignored, back this up)
```

Inbox passwords and API keys are encrypted at rest (AES-256-GCM). Locally the key lives in `data/secret.key` unless `BOULDLEADS_SECRET` is set; hosted, `BOULDLEADS_SECRET` is required. Locally the dashboard only listens on `127.0.0.1` and has no login; the hosted app requires `APP_USERS` logins.
