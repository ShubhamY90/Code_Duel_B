const express = require("express");
const router  = express.Router();
const { db }  = require("../config/firebase");
const { authenticateToken } = require("../middlewares/auth");

const REALTIME_URL    = process.env.REALTIME_SERVER_URL  || "http://localhost:3001";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET      || "";

/**
 * Push a match-result job to the BullMQ queue via the Realtime Server's
 * internal HTTP endpoint.  This keeps BullMQ knowledge out of the backend.
 */
async function enqueueMatchResult(payload) {
  const res = await fetch(`${REALTIME_URL}/internal/match-result`, {
    method:  "POST",
    headers: {
      "Content-Type":     "application/json",
      "x-internal-secret": INTERNAL_SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Realtime server rejected match-result: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * POST /api/matches/complete
 *
 * Called by the frontend at the end of every match (public or private).
 * Fetches both players' current ELO ratings from Firestore, then pushes a
 * job to the BullMQ "match-results" queue so the ELO worker updates them
 * atomically.
 *
 * For ties, winnerId = loserId = 'tie' is NOT valid here — the caller
 * must pass both participant IDs separately.
 *
 * Requires Bearer ID token in Authorization header.
 *
 * Body: {
 *   matchId:   string,
 *   roomId:    string,
 *   winnerId:  string | null,   // null → isDraw = true
 *   loserId:   string | null,   // null → isDraw = true
 *   player1Id: string,          // always required
 *   player2Id: string,          // always required
 *   isDraw:    boolean,
 *   matchType: 'public' | 'private',
 * }
 *
 * Returns { success: true }
 */
router.post("/complete", authenticateToken, async (req, res) => {
  const {
    matchId,
    roomId,
    player1Id,
    player2Id,
    winnerId,
    loserId,
    isDraw    = false,
    matchType = "public",
  } = req.body;

  if (!matchId || !roomId || !player1Id || !player2Id) {
    return res.status(400).json({
      error: "matchId, roomId, player1Id, player2Id are required",
    });
  }
  if (!isDraw && (!winnerId || !loserId)) {
    return res.status(400).json({
      error: "winnerId and loserId are required unless isDraw is true",
    });
  }
  if (!["public", "private"].includes(matchType)) {
    return res.status(400).json({ error: "matchType must be 'public' or 'private'" });
  }

  try {
    // Fetch both players' current ratings in parallel
    const [snap1, snap2] = await Promise.all([
      db.collection("users").doc(player1Id).get(),
      db.collection("users").doc(player2Id).get(),
    ]);

    if (!snap1.exists || !snap2.exists) {
      return res.status(404).json({ error: "One or both player profiles not found" });
    }

    const rating1 = snap1.data().rating ?? 1000;
    const rating2 = snap2.data().rating ?? 1000;

    let jobPayload;

    if (isDraw) {
      // For a draw, both IDs are "winner" and "loser" simultaneously — pass p1 as winner, p2 as loser
      // The ELO worker will detect isDraw and skip rating change for both
      jobPayload = {
        roomId,
        matchId,
        isDraw:    true,
        matchType,
        winnerId:  player1Id,
        loserId:   player2Id,
        winnerRating: rating1,
        loserRating:  rating2,
      };
    } else {
      const winnerRating = winnerId === player1Id ? rating1 : rating2;
      const loserRating  = loserId  === player1Id ? rating1 : rating2;

      jobPayload = {
        roomId,
        matchId,
        isDraw:    false,
        matchType,
        winnerId,
        loserId,
        winnerRating,
        loserRating,
      };
    }

    await enqueueMatchResult(jobPayload);

    console.log(
      `[POST /api/matches/complete] Enqueued ELO job — ` +
      `matchId=${matchId} isDraw=${isDraw} matchType=${matchType}`
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[POST /api/matches/complete] Error:", err.message);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

/**
 * GET /api/matches?matchType=public|private&limit=<n>
 *
 * Returns the authenticated user's past matches (newest first).
 * Reads from the Firestore "matches" collection filtered by participantIds.
 */
router.get("/", authenticateToken, async (req, res) => {
  const uid = req.user.uid;
  const { matchType, limit: limitParam } = req.query;
  const limit = Math.min(parseInt(limitParam) || 20, 50);

  try {
    let query = db.collection("matches").where("participantIds", "array-contains", uid);
    if (matchType && ["public", "private"].includes(matchType)) {
      query = query.where("matchType", "==", matchType);
    }

    const snap = await query.get();

    const docs = snap.docs.map((d) => {
      const data = d.data();
      return {
        id:               d.id,
        matchType:        data.matchType || "private",
        problemId:        data.problemId,
        winnerId:         data.winnerId,
        participantIds:   data.participantIds,
        completionReason: data.completionReason,
        durationSeconds:  data.durationSeconds,
        ratingDelta:      data.ratingDelta || {},
        participants:     data.participants || [],
        startedAt:        data.startedAt?.toDate?.()?.toISOString()   ?? null,
        completedAt:      data.completedAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    // Sort newest first
    docs.sort((a, b) => {
      if (!a.completedAt) return 1;
      if (!b.completedAt) return -1;
      return new Date(b.completedAt) - new Date(a.completedAt);
    });

    return res.status(200).json(docs.slice(0, limit));
  } catch (err) {
    console.error("[GET /api/matches] Error:", err.message);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

module.exports = router;
