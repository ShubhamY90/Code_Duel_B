const express = require("express");
const router  = express.Router();
const { db }  = require("../config/firebase");
const { authenticateToken } = require("../middlewares/auth");

/**
 * GET /api/submissions?limit=<n>
 *
 * Returns the authenticated user's submissions, newest first.
 * Sorted in-memory (no composite Firestore index required).
 *
 * Expects Bearer ID token in Authorization header.
 */
router.get("/", authenticateToken, async (req, res) => {
    const userId = req.user.uid;
    const { limit: limitParam } = req.query;
    const limit = Math.min(parseInt(limitParam) || 50, 100);

    try {
        const snap = await db
            .collection("submissions")
            .where("userId", "==", userId)
            .get();

        const docs = snap.docs.map((d) => {
            const data = d.data();
            return {
                id:          d.id,
                userId:      data.userId,
                problemId:   data.problemId,
                verdict:     data.verdict,
                passed:      data.passed,
                total:       data.total,
                // Convert Firestore Timestamp → ISO string for JSON transport
                submittedAt: data.submittedAt?.toDate?.()?.toISOString() ?? null,
            };
        });

        // Sort newest first (avoids needing a Firestore composite index)
        docs.sort((a, b) => {
            if (!a.submittedAt) return 1;
            if (!b.submittedAt) return -1;
            return new Date(b.submittedAt) - new Date(a.submittedAt);
        });

        return res.status(200).json(docs.slice(0, limit));
    } catch (err) {
        console.error("[GET /api/submissions] Error:", err.message);
        return res.status(500).json({ error: "Internal server error", message: err.message });
    }
});

module.exports = router;
