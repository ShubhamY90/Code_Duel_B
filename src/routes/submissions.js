const express = require("express");
const router  = express.Router();
const { db }  = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const { authenticateToken } = require("../middlewares/auth");

/**
 * Subcollection helper.
 *
 * Submissions are stored at:
 *   users/{uid}/privateSubmissions/{submissionId}
 *   users/{uid}/publicSubmissions/{submissionId}
 *
 * Each document contains:
 *   { userId, problemId, matchId, matchType, code, language,
 *     verdict, passed, total, submitCount, submittedAt }
 */
function submissionsColl(uid, matchType) {
  const subColl = matchType === "private" ? "privateSubmissions" : "publicSubmissions";
  return db.collection("users").doc(uid).collection(subColl);
}

/**
 * GET /api/submissions?matchType=public|private&limit=<n>
 *
 * Returns the authenticated user's submissions for the given matchType,
 * newest first. Defaults to public if matchType is not provided.
 *
 * Expects Bearer ID token in Authorization header.
 */
router.get("/", authenticateToken, async (req, res) => {
  const userId = req.user.uid;
  const { limit: limitParam, matchType = "public" } = req.query;
  const limit = Math.min(parseInt(limitParam) || 50, 100);

  if (!["public", "private"].includes(matchType)) {
    return res.status(400).json({ error: "matchType must be 'public' or 'private'" });
  }

  try {
    const snap = await submissionsColl(userId, matchType).get();

    const docs = snap.docs.map((d) => {
      const data = d.data();
      return {
        id:          d.id,
        userId:      data.userId,
        problemId:   data.problemId,
        matchId:     data.matchId   || null,
        matchType:   data.matchType || matchType,
        code:        data.code      || null,
        language:    data.language  || null,
        verdict:     data.verdict,
        passed:      data.passed,
        total:       data.total,
        submitCount: data.submitCount || 1,
        submittedAt: data.submittedAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    // Sort newest first
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

/**
 * POST /api/submissions
 *
 * Write a submission record to the appropriate user subcollection.
 * Called by the Compiler Server (or frontend) after a submission is graded.
 *
 * Body: {
 *   userId, problemId, matchId?, matchType, code, language,
 *   verdict, passed, total, submitCount
 * }
 *
 * Expects Bearer ID token in Authorization header.
 */
router.post("/", authenticateToken, async (req, res) => {
  const uid = req.user.uid;
  const {
    problemId,
    matchId   = null,
    matchType = "public",
    code      = "",
    language  = "",
    verdict,
    passed,
    total,
    submitCount = 1,
  } = req.body;

  if (!problemId || verdict === undefined || passed === undefined || total === undefined) {
    return res.status(400).json({
      error: "problemId, verdict, passed, total are required",
    });
  }

  if (!["public", "private"].includes(matchType)) {
    return res.status(400).json({ error: "matchType must be 'public' or 'private'" });
  }

  try {
    const docRef = await submissionsColl(uid, matchType).add({
      userId:      uid,
      problemId,
      matchId,
      matchType,
      code,
      language,
      verdict,
      passed,
      total,
      submitCount,
      submittedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[POST /api/submissions] Saved submission ${docRef.id} for user ${uid} (${matchType})`);
    return res.status(201).json({ id: docRef.id });
  } catch (err) {
    console.error("[POST /api/submissions] Error:", err.message);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

module.exports = router;
