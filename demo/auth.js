const jwt = require('jsonwebtoken');

// Weak secret, hardcoded
const JWT_SECRET = 'password123';

function generateToken(user) {
  // No expiration, includes sensitive data
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, ssn: user.ssn },
    JWT_SECRET
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Auth middleware — but never actually used on routes
function requireAuth(req, res, next) {
  const token = req.headers.authorization;
  // No "Bearer " prefix handling
  const decoded = verifyToken(token);
  if (decoded) {
    req.user = decoded;
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { generateToken, verifyToken, requireAuth };
