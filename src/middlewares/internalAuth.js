/**
 * Middleware: verifies the x-internal-secret header.
 * Used to protect endpoints that are only called by internal services
 * (e.g. Realtime_Server), not by end-users.
 */
function internalAuth(req, res, next) {
  const secret = process.env.INTERNAL_SECRET;

  if (!secret) {
    console.error('[internalAuth] INTERNAL_SECRET env var is not set');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized: invalid internal secret' });
  }

  next();
}

module.exports = { internalAuth };
