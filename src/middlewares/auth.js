const { auth } = require("../config/firebase");

async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized", message: "Bearer token missing" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("[Auth Middleware Error]:", error.message);
    return res.status(401).json({ error: "Unauthorized", message: "Invalid token" });
  }
}

module.exports = { authenticateToken };
