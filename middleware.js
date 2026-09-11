// Free Basic-Auth gate for the whole site (Vercel Edge Middleware — no Pro plan needed).
//
// Set these two env vars in Vercel → Project → Settings → Environment Variables
// (Production, and Preview if you want previews gated too), then redeploy:
//   SITE_USER = whatever username you want
//   SITE_PASS = whatever password you want
//
// Runs on every request before the static file is served.

export const config = {
  matcher: '/((?!favicon.ico).*)', // protect everything except the favicon
};

export default function middleware(req) {
  const user = process.env.SITE_USER;
  const pass = process.env.SITE_PASS;

  // Fail safe: if the env vars aren't set, don't lock everyone out silently —
  // but don't leave the site open either. Deny with a clear message instead.
  if (!user || !pass) {
    return new Response('Site auth is misconfigured (SITE_USER/SITE_PASS not set).', { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  const expected = 'Basic ' + btoa(`${user}:${pass}`);

  if (authHeader === expected) {
    return; // let the request through
  }

  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Secure Area"' },
  });
}
