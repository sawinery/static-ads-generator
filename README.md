# Library images

Drop images here and they'll automatically appear in the app's image library.

## How it works

When you commit and push images to this folder on `main`:

1. A GitHub Action (`.github/workflows/sync-library.yml`) runs.
2. It uploads each image to the Supabase `ad-inputs` storage bucket under `library/<filename>`.
3. It inserts a row in `public.library_images` so the image shows up in the **📚 Library** picker in the app.

The label shown in the app is the filename with the extension stripped and `-` / `_` replaced by spaces:
- `before-coffee.jpg` → `before coffee`
- `our_logo_v2.png` → `our logo v2`

## Required GitHub secrets

Set these once in the repo's Settings → Secrets and variables → Actions:

- `SUPABASE_URL` — e.g. `https://xxxxx.supabase.co`
- `SUPABASE_SERVICE_KEY` — the service-role key (the secret one, NOT anon)

## Supported formats

`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`

## Notes

- Re-uploading a file with the same name **replaces** the storage object and refreshes the label. Existing references in jobs still resolve to the same path, so they keep working.
- Renaming a file in the repo creates a NEW library entry (different storage key). The old one stays in the library until you remove it via the app's UI.
- This folder is **NOT** served by the website — only used as a source for the sync action. So you can dump GBs of source assets here without bloating the deployed site.
