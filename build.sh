#!/bin/sh
# Vercel build step: writes web/env.js with Supabase config from env vars.
# If SUPABASE_URL and SUPABASE_KEY are set in Vercel project settings, they get
# baked into env.js at build time and the UI auto-connects (no manual entry).
# If they're not set, env.js exports nothing and the UI falls back to localStorage.

set -e

cat > web/env.js <<EOF
// Auto-generated at build time. Do not edit by hand.
window.SUPABASE_CONFIG = {
  url: "${SUPABASE_URL:-}",
  key: "${SUPABASE_KEY:-}"
};
EOF

echo "build.sh: wrote web/env.js"
echo "  SUPABASE_URL: ${SUPABASE_URL:+set}${SUPABASE_URL:-NOT SET}"
echo "  SUPABASE_KEY: ${SUPABASE_KEY:+set}${SUPABASE_KEY:-NOT SET}"
