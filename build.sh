#!/bin/sh
# Vercel build step: writes env.js with Supabase config from env vars.
# Detects whether we're running from the repo root or from inside web/.
#
# If SUPABASE_URL and SUPABASE_KEY are set in Vercel project settings, they get
# baked into env.js at build time and the UI auto-connects (no manual entry).
# If they're not set, env.js is still generated but with empty values, and the
# UI falls back to localStorage / manual entry.

set -e

# Where to write env.js: 'web/env.js' if web/ exists (run from repo root),
# else just 'env.js' (run from inside web/).
if [ -d "web" ]; then
  OUT="web/env.js"
else
  OUT="env.js"
fi

cat > "$OUT" <<EOF
// Auto-generated at build time. Do not edit by hand.
window.SUPABASE_CONFIG = {
  url: "${SUPABASE_URL:-}",
  key: "${SUPABASE_KEY:-}"
};
EOF

echo "build.sh: wrote $OUT"
echo "  SUPABASE_URL: ${SUPABASE_URL:+set}${SUPABASE_URL:-NOT SET}"
echo "  SUPABASE_KEY: ${SUPABASE_KEY:+set}${SUPABASE_KEY:-NOT SET}"
