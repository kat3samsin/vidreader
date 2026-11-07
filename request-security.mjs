export const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self' https://www.youtube.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://i.ytimg.com; connect-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

export function isLoopback(address) {
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

export function checkRequest(req) {
  const host = req.headers.host;
  const authority = new URL(`http://${host}`);
  const address = req.socket.localAddress?.replace(/^::ffff:/, '');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', address?.includes(':') ? `[${address}]` : address]);
  if (!host || authority.host !== host || !allowedHosts.has(authority.hostname) || Number(authority.port || 80) !== req.socket.localPort) {
    return { status: 403, error: 'This host is not allowed.' };
  }
  if (!req.url.startsWith('/') || req.url.startsWith('//')) return { status: 400, error: 'Invalid request URL.' };
  const origin = `${req.socket.encrypted ? 'https' : 'http'}://${host}`;
  if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
    return { status: 403, error: 'Requests must come from this reader.' };
  }
  if (!isLoopback(req.socket.remoteAddress)) return { status: 403, error: 'Use this reader from localhost.' };
  if (req.method === 'POST' && (req.headers.origin !== origin || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))) {
    return { status: 403, error: 'Send JSON from this reader to use an AI action.' };
  }
  return null;
}
