const express = require("express");
const router  = express.Router();
const { db }  = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const { authenticateToken } = require("../middlewares/auth");

/**
 * POST /api/users/init
 *
 * Called by the frontend immediately after Firebase Auth sign-in.
 * Creates the user document only if it doesn't already exist,
 * so repeat logins never overwrite the rating or stats.
 *
 * Expects Bearer ID token in Authorization header.
 * Body: { displayName, photoURL }
 */
router.post("/init", authenticateToken, async (req, res) => {
    const { uid, email } = req.user;
    const { displayName, photoURL } = req.body;

    if (!uid || !email) {
        return res.status(400).json({ error: "uid and email are required in token" });
    }

    try {
        const ref  = db.collection("users").doc(uid);
        const snap = await ref.get();

        if (snap.exists) {
            // User already exists — return current doc, nothing to do
            return res.status(200).json({ created: false, user: snap.data() });
        }

        const newUser = {
            uid,
            displayName: displayName || email.split("@")[0],
            email,
            photoURL:    photoURL || null,
            createdAt:   FieldValue.serverTimestamp(),
            rating:      1000,

            // ── Public match stats ──
            matchesPlayedPublic: 0,
            matchesWonPublic:    0,
            matchesLostPublic:   0,
            matchesTiedPublic:   0,

            // ── Private match stats ──
            matchesPlayedPrivate: 0,
            matchesWonPrivate:    0,
            matchesLostPrivate:   0,
            matchesTiedPrivate:   0,
        };

        await ref.set(newUser);
        console.log(`[users/init] Created user document for ${uid}`);

        return res.status(201).json({ created: true, user: newUser });
    } catch (err) {
        console.error("[POST /api/users/init] Error:", err.message);
        return res.status(500).json({ error: "Internal server error", message: err.message });
    }
});

/**
 * GET /api/users/:uid
 * Returns the user's profile document.
 */
router.get("/:uid", async (req, res) => {
    const { uid } = req.params;
    try {
        const snap = await db.collection("users").doc(uid).get();
        if (!snap.exists) {
            return res.status(404).json({ error: "User not found" });
        }
        return res.status(200).json(snap.data());
    } catch (err) {
        console.error(`[GET /api/users/${uid}] Error:`, err.message);
        return res.status(500).json({ error: "Internal server error", message: err.message });
    }
});

const { internalAuth } = require("../middlewares/internalAuth");

/**
 * POST /api/users/update-ratings-internal
 *
 * Internal-only endpoint called by the ELO worker after a match completes.
 * Atomically updates both players' ratings and match stats in Firestore.
 *
 * Protected by x-internal-secret header (no Firebase Auth).
 *
 * Body: {
 *   roomId, winnerId, loserId,
 *   newWinnerRating, newLoserRating,
 *   winnerDelta, loserDelta,
 *   matchType: 'public' | 'private',
 *   isDraw: boolean,
 * }
 * Returns { success: true }
 */
router.post("/update-ratings-internal", internalAuth, async (req, res) => {
  const {
    winnerId,
    loserId,
    newWinnerRating,
    newLoserRating,
    winnerDelta,
    loserDelta,
    roomId,
    matchType = "public",
    isDraw    = false,
  } = req.body;

  // For a draw, winnerId and loserId represent both participants
  if (!winnerId || !loserId || newWinnerRating == null || newLoserRating == null) {
    return res.status(400).json({
      error: "winnerId, loserId, newWinnerRating, newLoserRating are required",
    });
  }

  const isPublic  = matchType === "public";
  const winnerRef = db.collection("users").doc(winnerId);
  const loserRef  = db.collection("users").doc(loserId);

  try {
    const batch = db.batch();

    if (isDraw) {
      // Tie: both players' ratings unchanged, increment tied counter for both
      const tiedField   = isPublic ? "matchesTiedPublic"   : "matchesTiedPrivate";
      const playedField = isPublic ? "matchesPlayedPublic"  : "matchesPlayedPrivate";

      batch.update(winnerRef, {
        [playedField]:   FieldValue.increment(1),
        [tiedField]:     FieldValue.increment(1),
        lastMatchAt:     FieldValue.serverTimestamp(),
      });
      batch.update(loserRef, {
        [playedField]:   FieldValue.increment(1),
        [tiedField]:     FieldValue.increment(1),
        lastMatchAt:     FieldValue.serverTimestamp(),
      });
    } else {
      // Win/Loss: update ratings + per-mode win and loss counters
      const winnerPlayedField = isPublic ? "matchesPlayedPublic"  : "matchesPlayedPrivate";
      const winnerWonField    = isPublic ? "matchesWonPublic"     : "matchesWonPrivate";
      const loserPlayedField  = isPublic ? "matchesPlayedPublic"  : "matchesPlayedPrivate";
      const loserLostField    = isPublic ? "matchesLostPublic"    : "matchesLostPrivate";

      batch.update(winnerRef, {
        rating:           newWinnerRating,
        [winnerPlayedField]: FieldValue.increment(1),
        [winnerWonField]:    FieldValue.increment(1),
        lastMatchAt:      FieldValue.serverTimestamp(),
      });

      batch.update(loserRef, {
        rating:           newLoserRating,
        [loserPlayedField]:  FieldValue.increment(1),
        [loserLostField]:    FieldValue.increment(1),
        lastMatchAt:      FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();

    console.log(
      `[POST /api/users/update-ratings-internal] roomId=${roomId} matchType=${matchType} isDraw=${isDraw} — ` +
      (isDraw
        ? `tie between ${winnerId} and ${loserId}`
        : `${winnerId}: +${winnerDelta} → ${newWinnerRating} | ${loserId}: ${loserDelta} → ${newLoserRating}`)
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[POST /api/users/update-ratings-internal] Error:", err.message);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

module.exports = router;
