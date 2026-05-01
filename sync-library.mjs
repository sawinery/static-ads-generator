// Walks the /library/ folder of the repo, uploads each image to the
// 'ad-inputs' Supabase bucket (skipping ones already there), and inserts
// rows into public.library_images so they appear in the app.
//
// Idempotent: re-running won't duplicate. Filename is used as the storage
// key, so editing/replacing a file in the repo updates the same storage
// object (upsert).
//
// Label = the filename without extension, transformed: 'before-coffee.jpg' → 'before coffee'.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const LIBRARY_DIR = 'library';
const BUCKET = 'ad-inputs';
const ALLOWED = /\.(png|jpe?g|webp|gif)$/i;

function mimeFromExt(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
  }[ext] || 'application/octet-stream';
}

function labelFromFilename(filename) {
  return filename
    .replace(/\.[^.]+$/, '')   // drop extension
    .replace(/[-_]+/g, ' ')    // hyphens/underscores → spaces
    .trim();
}

async function main() {
  if (!fs.existsSync(LIBRARY_DIR)) {
    console.log(`No ${LIBRARY_DIR}/ directory; nothing to sync.`);
    return;
  }

  const files = fs.readdirSync(LIBRARY_DIR)
    .filter(f => ALLOWED.test(f) && fs.statSync(path.join(LIBRARY_DIR, f)).isFile());

  if (files.length === 0) {
    console.log(`${LIBRARY_DIR}/ is empty.`);
    return;
  }

  console.log(`Found ${files.length} image(s) in ${LIBRARY_DIR}/`);

  for (const filename of files) {
    const filepath = path.join(LIBRARY_DIR, filename);
    // Use a stable storage key so re-uploads overwrite the same object.
    const storageKey = `library/${filename}`;
    const bytes = fs.readFileSync(filepath);
    const mime = mimeFromExt(filename);

    // Upload (upsert)
    const upRes = await sb.storage.from(BUCKET).upload(storageKey, bytes, {
      contentType: mime,
      upsert: true,
    });
    if (upRes.error) {
      console.error(`  ✗ ${filename}: upload failed — ${upRes.error.message}`);
      continue;
    }

    // Insert library row if not already present (image_path is unique)
    const label = labelFromFilename(filename);
    const { data: existing } = await sb
      .from('library_images')
      .select('id')
      .eq('image_path', storageKey)
      .maybeSingle();

    if (existing) {
      // Update label in case the filename was renamed in the repo
      await sb.from('library_images').update({ label }).eq('id', existing.id);
      console.log(`  ↻ ${filename} (already in library; label refreshed)`);
    } else {
      const { error } = await sb.from('library_images').insert({
        image_path: storageKey,
        label,
      });
      if (error) {
        console.error(`  ✗ ${filename}: insert failed — ${error.message}`);
      } else {
        console.log(`  + ${filename} → library`);
      }
    }
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
