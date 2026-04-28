# Meta Ad Generator

Personal tool for generating static Meta ads with `gpt-image-2`. Backend runs entirely on Supabase Edge Functions (no browser-side OpenAI calls). Submit a batch, close your laptop.

## Deployment — no terminal required

Everything below is done in your browser via the Supabase dashboard + GitHub.

### 1. Create a Supabase project

[supabase.com](https://supabase.com) → New project. Pick any region close to you. Wait ~2 min for it to provision.

### 2. Run the database migrations

Dashboard → **SQL Editor** → New query. Paste each file's contents and click **Run**. Run them in this exact order:

1. `supabase/migrations/20260427000000_init.sql`
2. `supabase/migrations/20260427000200_claim_rpc.sql`
3. `supabase/migrations/20260427000100_cron.sql`

Each one should say "Success. No rows returned." If any fail, fix before continuing.

### 3. Create the storage buckets

Dashboard → **Storage** → New bucket.

- Name: `ad-inputs` — Public: **off** — Create
- Name: `ad-outputs` — Public: **off** — Create

### 4. Add the OpenAI API key as a secret

Dashboard → **Edge Functions** → **Secrets** (or Settings → Edge Functions). Add:

- Name: `OPENAI_API_KEY`
- Value: your `sk-...` key from OpenAI

> **Required:** your OpenAI org must be **verified** for `gpt-image-2` access. Do this at platform.openai.com → Settings → Organization → Verify.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase — you don't add them manually.

### 5. Deploy the Edge Functions (browser editor)

Dashboard → **Edge Functions** → **Deploy a new function**.

**Function 1:**
- Name: `process-job`
- Paste the entire contents of `supabase/functions/process-job/index.ts`
- Click Deploy

**Function 2:**
- Name: `submit-job`
- Paste the entire contents of `supabase/functions/submit-job/index.ts`
- Click Deploy

Both files are self-contained — no extra files to upload.

### 6. Wire up the cron kicker

The pg_cron job in step 2 calls a function that needs to know your project URL and service-role key. Find both:

- **Project URL:** Dashboard → Settings → API → "Project URL" (looks like `https://xxxxx.supabase.co`)
- **Service-role key:** Dashboard → Settings → API → "service_role" key (the secret one, not anon)

Then SQL Editor → run this (substitute your real values):

```sql
select vault.create_secret(
  'https://YOUR-PROJECT.supabase.co/functions/v1/process-job',
  'edge_url'
);
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
```

### 7. Host the UI

Two ways:

**Option A — Just open the file locally.** Download `web/index.html`, double-click to open in your browser.

**Option B — Deploy to Vercel via GitHub (recommended).** Push the repo to GitHub. On Vercel: New Project → Import the repo → Deploy. The included `vercel.json` + `build.sh` handle everything.

#### Skip the manual key entry (optional)

If you want the app to auto-connect without typing keys every time, set these as **Vercel project env variables** (Vercel dashboard → your project → Settings → Environment Variables):

- `SUPABASE_URL` = your project URL (e.g. `https://xxxxx.supabase.co`)
- `SUPABASE_KEY` = your service-role key

Then redeploy. The Connection panel disappears and the app auto-connects.

> **Heads up:** the key gets baked into the public bundle at build time. Anyone who finds your Vercel URL and views source can read it. That's fine for a personal tool you don't share, but DO NOT do this if your Vercel URL might leak — use the manual entry path instead.

### 8. Use it

Open the UI. In the connection panel paste:
- Supabase URL (from step 6)
- Service-role key (from step 6)

Both are stored in your browser's localStorage only. Click **Save & test**. Then submit ads.

---

## How it works

```
Browser UI → Supabase ── jobs (one row per ad concept)
                      ── variants (one row per generated image)
                      ── Storage: ad-inputs/ ad-outputs/

Insert job → trigger queues 9:16 variant
                │
       Edge Function `process-job`:
       - claim 1 pending variant (FOR UPDATE SKIP LOCKED)
       - download reference image if any
       - call gpt-image-2
       - upload PNG to ad-outputs/
       - compute cost from response.usage
       - mark completed
       - if generate_square → trigger queues 1:1 variant
       - self-invoke if more pending work
                │
       pg_cron heartbeat every minute as safety net
```

## How requirements map to code

| Your requirement | Where |
|---|---|
| Use gpt-image-2 | `process-job/index.ts`, `model: 'gpt-image-2'` |
| Upload image + prompt | UI uploads to `ad-inputs/` → `jobs.reference_image_path` → worker downloads + sends to `/images/edits` |
| Edit text of generated ad | "Edit text" button → `submit-job/edit-text` → child variant with `parent_variant_id` → worker re-prompts edit endpoint with parent image |
| 9:16 first, optional 1:1 | `jobs_after_insert` trigger always queues 9:16 (`1024x1792`). `maybe_queue_square` queues 1:1 (`1024x1024`) only when 9:16 completes AND `generate_square=true` |
| Quality choice | `low/medium/high` enum on jobs, passed straight to OpenAI |
| Cost per generation | `computeCost()` reads `usage` from API response, multiplies by per-token rates. UI shows per-variant cost + batch total |
| Download files | UI calls `sb.storage.from('ad-outputs').download()` |
| Backend-only batches | Edge Functions + pg_cron heartbeat keep batches running with the browser closed |

## Cost reference (gpt-image-2, April 2026)

| Size | low | medium | high |
|---|---|---|---|
| 1024×1024 (1:1) | ~$0.006 | ~$0.053 | ~$0.211 |
| 1024×1792 (9:16) | ~$0.005 | ~$0.041 | ~$0.165 |

Real per-call cost is computed from the API's `usage` response. Edit-endpoint calls (text edits, ads with reference images) include image input tokens at $8/1M, adding a few cents.

## Things to watch

- **Edge Function 150s wall clock.** A high-quality generation can take 30-90s. One variant per invocation = safe. Chain handles batches.
- **OpenAI org verification.** Required for `gpt-image-2`.
- **Custom sizes must be multiples of 16.** `1024x1792` is fine. Don't change to weird numbers.
- **Pricing constants.** Hard-coded in `process-job/index.ts` at the top. Update if OpenAI changes rates.
- **Service-role key in browser localStorage.** Fine for personal use on your own machine. If you ever share this, switch to anon key + Supabase Auth + RLS.

## Updating the code later

Edit the function in the Supabase dashboard editor → click Deploy. That's it. No CLI, no git push for the backend (though committing to GitHub is still smart for backup).
