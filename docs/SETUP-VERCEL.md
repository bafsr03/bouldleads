# Put BouldLeads online for the team (about 45 minutes)

You'll end with `https://<your-app>.vercel.app`, where Brian and Jake each sign in with their own name and password, see the same leads, and every call/email updates live. Everything below is free (Vercel Hobby + Turso free tier + cron-job.org).

Keep a text file open as you go: you'll collect a few secrets and need them more than once. **Never paste them in Slack or email.**

---

## 1. Accounts (5 min)
1. **Vercel**: sign up at vercel.com (GitHub login is easiest). The free Hobby plan is enough.
2. **cron-job.org** (runs the background work every minute): sign up at cron-job.org.
3. On your Mac, update the Vercel CLI and log in:
   ```bash
   npm i -g vercel@latest
   vercel login
   ```

## 2. Create the project and its free database (5 min)
```bash
cd ~/Desktop/bouldleads
vercel link            # "Set up and deploy?" → yes · scope: your account · new project name: bouldleads
```
Then in the Vercel dashboard → your **bouldleads** project → **Storage** → **Create Database** → **Turso** (Marketplace) → free plan → name it `bouldleads`, pick the region closest to you → **Connect** to the project (all environments).
That's it: Vercel adds the database address and token to the project's environment variables for you, and the app picks them up (it accepts the names the integration uses). Free tier: 5 GB, 500M reads and 10M writes a month.

## 3. Make the secrets (2 min)
In the project folder (`~/Desktop/bouldleads`):
```bash
openssl rand -base64 32   # → BOULDLEADS_SECRET (encrypts inbox passwords; never change it later)
openssl rand -base64 32   # → SESSION_SECRET   (signs logins)
openssl rand -hex 24      # → CRON_SECRET      (protects the background job URL; hex = safe in a URL)
npm run hash-password -- Brian 'brians-password'
npm run hash-password -- Jake  'jakes-password'
```
The two `hash-password` lines print something like `Jake:scrypt.Xy…`. Join them with a comma: that's `APP_USERS`:
```
APP_USERS=Brian:scrypt.AAAA…,Jake:scrypt.BBBB…
```

## 4. Add the variables (5 min)
Add each one for **Production** (it asks you to paste the value):
```bash
vercel env add BOULDLEADS_SECRET production
vercel env add SESSION_SECRET production
vercel env add CRON_SECRET production
vercel env add APP_USERS production
vercel env add GOOGLE_PLACES_API_KEY production    # optional but recommended (Tier A needs Google data)
```

## 5. Deploy (3 min)
```bash
vercel deploy --prod
```
It prints the live URL. Open it: you should see the **sign-in page**. Sign in as Brian.

## 6. Copy your current leads online (2 min, optional)
If you want Jake to start with what's on your Mac (leads, calls, searches):
```bash
vercel env pull .env.production.local --environment=production --yes
set -a; source .env.production.local; set +a
npm run copy-to-hosted
rm .env.production.local      # don't leave secrets lying around
```
It refuses to overwrite an online database that already has leads (add `-- --force` to merge on purpose). Inboxes and API keys aren't copied (they're encrypted with your Mac's key): re-add them online in step 8.

> Heads-up: you deleted the Lima and Salt Lake City leads tonight with "don't add back" ticked. If you want them found again, open **Settings → Deleted leads → Allow them back** (locally before copying, or online afterwards) and re-run the search.

## 7. Turn on the every-minute background job (5 min)
Searches, email finding, audits and sending all run from one URL. On cron-job.org → **Create cronjob**:
- **URL**: `https://<your-app>.vercel.app/api/cron/tick?key=<CRON_SECRET>&budget=25`
- **Schedule**: every 1 minute
- **Notifications**: turn off "notify on failure" (long searches sometimes take longer than cron-job.org waits; the work still finishes)
- Save. After a minute, the app's sidebar shows **Background: just now** with a green dot.

(`vercel.json` also schedules it once a day from Vercel itself, as a safety net. On Vercel Pro you can switch that to every minute and skip cron-job.org.)

## 8. First sign-in setup (10 min)
In the live app as Brian:
1. **Settings**: company name, postal address (required in every email), **Time zone** (e.g. America/Lima), Google Places key if you didn't set it as a variable. Under **Calling**, check "No answer / Voicemail starts the emails" is on and the Personal list tier. Save.
2. **Inboxes**: add the sending mailbox(es) on your *second* domain (Google Workspace or Zoho), press **Test**, then **Check DNS** (SPF, DKIM and DMARC should all be green). New inboxes join the no-answer follow-up automatically.
3. **Emails → No-answer follow-up**: read the 4 emails, adjust wording, make sure your inbox is ticked, **Save**.
4. **Find leads**: run one real search (e.g. *Smoke shops* in *Lima, Peru*, source *Google + OpenStreetMap*, Must have *Any contact: phone counts*). Watch **Places** light up.

## 9. Smoke test before you send Jake the link (5 min)
1. **Call list** → pick a lead that has an email → press **No answer**. The toast says the follow-up starts.
2. Within the send window, after a minute or two, the email shows on the lead page (**Activity**) and in your inbox's *Sent* folder.
3. Reply to it from another address: within ~5 minutes the lead moves to **Replied** on the call list.
4. Open the app on your phone too.

## 10. Send Jake
- the URL
- his name (`Jake`) and password, **by phone or in person**, not in writing
- the guide: `docs/JAKE.md` (or the shared page link)

## If something's wrong
| Symptom | Fix |
|---|---|
| Sidebar says "Background tasks stopped" | cron-job.org job off or wrong URL/key. Open the URL in a browser: you should get JSON with `"ran": true`. |
| Sign-in says wrong password | Re-run `npm run hash-password`, update `APP_USERS` with `vercel env rm APP_USERS production` + `vercel env add …`, then `vercel deploy --prod`. |
| "Set BOULDLEADS_SECRET…" error | The variable is missing: add it and redeploy. |
| Emails don't send | Settings: company + address set? Time zone and send hours right? Inbox active and ticked in *Emails → No-answer follow-up*? |
| Searches find little | Add the Google Places key; use specific business types instead of "All businesses". |
