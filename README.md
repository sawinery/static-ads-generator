# Meta Ad Generator

Personal tool for generating static Meta ads (and YouTube thumbnails) with `gpt-image-2`. Backend runs on Supabase Edge Functions; frontend is a single HTML file hosted on Vercel.

## What it does

- Generate ads from a prompt (single or multi-image references)
- Three aspect ratios: 9:16 (Stories/Reels), 1:1 (Feed), 16:9 (YouTube)
- Quality control: low / medium / high
- Multiple variations per aspect
- Edit existing ads with freeform prompts
- Reformat any ad to a different aspect ratio (9:16 → 1:1, etc.) — attached to the original card, not as a separate one
- Reuse any generated ad as a reference for a new prompt
- Custom card names that drive the download filenames
- Collections (custom-named tabs you can add ads to)
- Image library — reusable images, including a GitHub Action to sync from a `library/` folder
- Editable prompt templates with 7 starter examples
- Persistent prompt add-on prepended to every prompt (style guide, brand voice, etc.)
- Meta safe-zone enforcement (text stays out of FB/IG UI overlays)
- Per-generation cost tracking (computed from OpenAI's token usage response)
- Bulk download all aspects of one card, or all ads in a collection
- Sequential card numbers + relative timestamps
- Egress-optimized: stores small JPEG thumbnails for grid display, full PNGs only on click

## Architecture

```
Browser UI ──▶ Supabase ──┬─ jobs                    (one row per ad concept)
                          ├─ variants                (one row per generated image)
                          ├─ job_images              (multi-image references with roles)
                          ├─ collections             (named tabs)
                          ├─ variant_collections     (many-to-many)
                          ├─ library_images          (reusable image picker)
                          ├─ prompt_templates        (editable starter prompts)
                          └─ Storage                 ad-inputs/  ad-outputs/

  Insert job ──▶ trigger queues N×M variants (aspects × variations)
                                │
                  Edge Function `process-job`:
                  ─ claim 1 pending variant (FOR UPDATE SKIP LOCKED)
                  ─ download reference image(s)
                  ─ POST to OpenAI gpt-image-2 (generations or edits)
                  ─ upload PNG + small JPEG thumbnail to ad-outputs/
                  ─ compute cost from response.usage
                  ─ store final_prompt for debugging
                  ─ self-invoke if more pending work
                                │
                  pg_cron heartbeat every minute as safety net
```

## One-time setup

### 1. Supabase project

[supabase.com](https://supabase.com) → New project. Wait for it to provision.

### 2. Run the database migrations (in order)

Dashboard → SQL Editor → paste each file's contents and click Run, in this order:

```
supabase/migrations/20260427000000_init.sql
supabase/migrations/20260427000200_claim_rpc.sql
supabase/migrations/20260427000100_cron.sql
supabase/migrations/20260427000300_fix_aspect_size.sql
supabase/migrations/20260427000400_aspects_and_variations.sql
supabase/migrations/20260427000500_safe_zones.sql
supabase/migrations/20260427000600_youtube_and_favorites.sql
supabase/migrations/20260427000700_variation_index.sql
supabase/migrations/20260427000800_final_prompt.sql
supabase/migrations/20260427000900_collections_and_seq.sql
supabase/migrations/20260427001000_thumb_path.sql
supabase/migrations/20260427001100_job_images.sql
supabase/migrations/20260427001200_image_library.sql
supabase/migrations/20260427001300_display_name.sql
supabase/migrations/20260427001400_prompt_templates.sql
```

### 3. Create storage buckets

Dashboard → Storage → New bucket. Both private:
- `ad-inputs`
- `ad-outputs`

### 4. Add the OpenAI API key

Dashboard → Edge Functions → Secrets → add:
- `OPENAI_API_KEY` = your `sk-...` key

Your OpenAI org must be **verified** for `gpt-image-2` access (platform.openai.com → Settings → Organization → Verify).

### 5. Deploy Edge Functions

Dashboard → Edge Functions → Deploy a new function. Paste the contents of:
- `supabase/functions/process-job/index.ts` → name `process-job`
- `supabase/functions/submit-job/index.ts` → name `submit-job`
- (Optional) `supabase/functions/backfill-thumbs/index.ts` → name `backfill-thumbs` — one-shot tool for old variants

### 6. Vault secrets for the cron heartbeat

Find your **Project URL** and **service-role key** in Settings → API. Then SQL Editor:

```sql
select vault.create_secret(
  'https://YOUR-PROJECT.supabase.co/functions/v1/process-job',
  'edge_url'
);
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
```

If you've already created these secrets earlier and need to update the value, use `vault.update_secret(...)` instead.

### 7. Host the UI

Push the repo to GitHub. On Vercel: New Project → Import. Build command and output directory are configured by `vercel.json` (or you can leave defaults if you removed it — `web/` will serve as a static directory).

### 8. (Optional) Set up the image-library GitHub Action

If you want to drop images into the repo and have them auto-appear in the app's library:

1. Push `.github/workflows/sync-library.yml` and `.github/scripts/sync-library.mjs`.
2. Repo → Settings → Secrets and variables → Actions → add:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_SERVICE_KEY` = your service-role key
3. Drop images in `library/` and push. The action runs and they appear in the 📚 Library tab in the app within ~30 seconds.

### 9. First connect

Open your Vercel URL. Paste the Supabase URL + service-role key into the Connection panel → Save & test. Stored in browser localStorage; you only do this once per browser.

## File map

```
supabase/
  config.toml
  migrations/                  ← run in numeric order in SQL editor
  functions/
    process-job/               ← worker (calls gpt-image-2, generates thumbnails)
    submit-job/                ← optional helper for /derive endpoint
    backfill-thumbs/           ← one-shot: generate thumbs for old variants
web/
  index.html                   ← the entire UI
.github/
  workflows/sync-library.yml   ← auto-syncs /library/ to Supabase
  scripts/sync-library.mjs
library/                       ← drop images here to add to your library (NOT served by Vercel)
vercel.json                    ← Vercel build config (optional)
```

## Cost reference (gpt-image-2)

| Size | low | medium | high |
|---|---|---|---|
| 1024×1024 (1:1) | ~$0.006 | ~$0.053 | ~$0.211 |
| 1152×2048 (9:16) | ~$0.006 | ~$0.054 | ~$0.215 |
| 1920×1088 (16:9) | ~$0.006 | ~$0.054 | ~$0.215 |

Real per-call cost is computed from the API's `usage` field. Edit-endpoint calls (anything with a reference image) include image input tokens at $8/1M, adding a few cents.

## Things to watch

- **Edge Function 150s wall-clock.** A single high-quality generation takes 30-90s. The worker processes one variant per invocation and chains itself — so batches of 100 ads work fine, just sequentially.
- **OpenAI org verification** is required for `gpt-image-2`.
- **Custom sizes must be multiples of 16.** All aspects we use already comply.
- **Pricing constants** are hard-coded near the top of `process-job/index.ts`. Update if OpenAI changes rates.
- **Egress** can spike if the gallery loads many full-size PNGs. The current setup serves small JPEG thumbnails for the grid (~30-50KB each) and only loads full PNGs on lightbox click or download. If you have variants from before this optimization, run the `backfill-thumbs` function once to generate thumbs for them.
- **Service-role key in browser localStorage** is fine for a personal tool you run on your own machine. If you ever expose this URL publicly, switch to anon key + Supabase Auth + RLS.

## Updating later

Each piece deploys independently:

- **UI changes** → push `web/index.html` → Vercel auto-rebuilds
- **Edge Function changes** → paste into Supabase dashboard editor → Deploy
- **Schema changes** → SQL Editor
- **Library images** → drop in `library/`, push, GitHub Action handles it
