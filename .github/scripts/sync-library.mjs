// Walks /library/ recursively (one level of subfolders), uploads each image to
// the 'ad-inputs' Supabase bucket, and inserts/updates a row in
// public.library_images. Subfolder name becomes the row's `folder` value.
//
// Examples:
//   library/before-coffee.jpg          → folder = NULL (top-level)
//   library/coffee/bag-front.jpg       → folder = "coffee"
//   library/garage-flooring/chip.jpg   → folder = "garage-flooring"
//
// Idempotent: re-running won't duplicate. Filename + folder is the unique key.

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
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

// Walk one level deep: top-level files + files in immediate subfolders.
function listImages() {
  const out = [];
  if (!fs.existsSync(LIBRARY_DIR)) return out;

  const entries = fs.readdirSync(LIBRARY_DIR, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(LIBRARY_DIR, entry.name);
    if (entry.isFile() && ALLOWED.test(entry.name)) {
      out.push({ filename: entry.name, folder: null, fullPath });
    } else if (entry.isDirectory()) {
      // One level of subfolders
      const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isFile() && ALLOWED.test(sub.name)) {
          out.push({
            filename: sub.name,
            folder: entry.name,    // top-level subfolder name only
            fullPath: path.join(fullPath, sub.name),
          });
        }
        // Deeper nesting is ignored — keep it flat for clarity
      }
    }
  }
  return out;
}

async function main() {
  if (!fs.existsSync(LIBRARY_DIR)) {
    console.log(`No ${LIBRARY_DIR}/ directory; nothing to sync.`);
    return;
  }

  const items = listImages();
  if (items.length === 0) {
    console.log(`${LIBRARY_DIR}/ is empty.`);
    return;
  }

  console.log(`Found ${items.length} image(s) in ${LIBRARY_DIR}/`);

  for (const item of items) {
    const { filename, folder, fullPath } = item;
    // Storage key includes folder so files with the same name in different
    // folders don't collide.
    const storageKey = folder
      ? `library/${folder}/${filename}`
      : `library/${filename}`;
    const bytes = fs.readFileSync(fullPath);
    const mime = mimeFromExt(filename);
    const label = labelFromFilename(filename);
    const folderLabel = folder ? `[${folder}] ` : '';

    // Upload (upsert)
    const upRes = await sb.storage.from(BUCKET).upload(storageKey, bytes, {
      contentType: mime,
      upsert: true,
    });
    if (upRes.error) {
      console.error(`  ✗ ${folderLabel}${filename}: upload failed — ${upRes.error.message}`);
      continue;
    }

    // Insert or update library row (image_path is unique)
    const { data: existing } = await sb
      .from('library_images')
      .select('id')
      .eq('image_path', storageKey)
      .maybeSingle();

    if (existing) {
      await sb.from('library_images')
        .update({ label, folder })
        .eq('id', existing.id);
      console.log(`  ↻ ${folderLabel}${filename} (refreshed)`);
    } else {
      const { error } = await sb.from('library_images').insert({
        image_path: storageKey,
        label,
        folder,
      });
      if (error) {
        console.error(`  ✗ ${folderLabel}${filename}: insert failed — ${error.message}`);
      } else {
        console.log(`  + ${folderLabel}${filename} → library`);
      }
    }
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
