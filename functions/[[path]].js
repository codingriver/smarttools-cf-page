const BLOCKED_PATHS = new Set([
  '/README.md',
  '/README_CN.md',
  '/package.json',
  '/package-lock.json',
  '/.gitignore',
  '/.gitattributes',
  '/.assetsignore',
  '/.env',
  '/.dev.vars'
]);

const BLOCKED_PREFIXES = [
  '/scripts/',
  '/screenshot/',
  '/functions/',
  '/node_modules/',
  '/.github/',
  '/.git/',
  '/.wrangler/',
  '/.env.'
];

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  const blocked = BLOCKED_PATHS.has(pathname)
    || BLOCKED_PREFIXES.some(prefix => pathname.startsWith(prefix));

  if (!blocked) return context.next();

  return new Response('Not Found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex'
    }
  });
}
