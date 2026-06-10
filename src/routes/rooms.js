const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const { authenticateToken } = require("../middlewares/auth");

// Helper to generate a 6-character random mixed-case alphanumeric room code
function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * POST /api/rooms/create
 * Creates a new private duel room with a random problem, unique roomCode, ready states, and "waiting" status.
 * Requires Authentication.
 */
router.post("/create", authenticateToken, async (req, res) => {
  const hostId = req.user.uid;
  if (!hostId) {
    return res.status(400).json({ error: "Host ID not found in token" });
  }

  try {
    // 1. Pick a random problem from the 'problems' collection
    const docRefs = await db.collection("problems").listDocuments();
    let problemId = "";

    if (docRefs.length > 0) {
      const randomRef = docRefs[Math.floor(Math.random() * docRefs.length)];
      problemId = randomRef.id;
    } else {
      // Fallback: list from problem_testcases in case 'problems' is empty
      const testcaseRefs = await db.collection("problem_testcases").listDocuments();
      if (testcaseRefs.length === 0) {
        return res.status(404).json({ error: "No problems found in the database" });
      }
      const randomRef = testcaseRefs[Math.floor(Math.random() * testcaseRefs.length)];
      problemId = randomRef.id;
    }

    console.log(`[POST /api/rooms/create] Selected random problem ID: ${problemId}`);

    // 2. Generate a unique roomCode
    let roomCode = "";
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      roomCode = generateRoomCode();
      const querySnap = await db.collection("rooms")
        .where("roomCode", "==", roomCode)
        .limit(1)
        .get();

      if (querySnap.empty) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      console.error("[POST /api/rooms/create] Collision threshold exceeded generating unique roomCode");
      return res.status(500).json({ error: "Failed to generate a unique room code" });
    }

    // 3. Construct the room document with readiness properties
    const roomDoc = {
      roomCode,
      creatorId: hostId,
      problemId,
      status: "waiting",
      matchId: null,        // populated when match completes
      startedAt: null,
      completedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      participants: {
        [hostId]: {
          userId: hostId,
          ready: false,
          score: 0,
          testCasesPassed: 0,
          progress: 0,
          solved: false,
          bestCode: ""
        }
      }
    };

    const docRef = await db.collection("rooms").add(roomDoc);
    console.log(`[POST /api/rooms/create] Created room document ${docRef.id} with code ${roomCode}`);

    return res.status(201).json({
      roomId: docRef.id,
      roomCode
    });
  } catch (error) {
    console.error("[POST /api/rooms/create] Error:", error.message);
    return res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

/**
 * POST /api/rooms/join
 * Joins an existing waiting duel room using the 6-character roomCode.
 * Requires Authentication.
 */
router.post("/join", authenticateToken, async (req, res) => {
  const { roomCode } = req.body;
  const guestId = req.user.uid;

  if (!roomCode) {
    return res.status(400).json({ error: "Room code is required" });
  }

  try {
    // 1. Query Firestore for room with roomCode and status "waiting"
    const querySnap = await db.collection("rooms")
      .where("roomCode", "==", roomCode)
      .where("status", "==", "waiting")
      .limit(1)
      .get();

    if (querySnap.empty) {
      // Check if room exists but status is already active/completed
      const codeOnlySnap = await db.collection("rooms")
        .where("roomCode", "==", roomCode)
        .limit(1)
        .get();

      if (codeOnlySnap.empty) {
        return res.status(404).json({ error: "Room not found" });
      } else {
        const existingRoom = codeOnlySnap.docs[0].data();
        if (existingRoom.creatorId === guestId) {
          return res.status(200).json({
            roomId: codeOnlySnap.docs[0].id,
            roomCode
          });
        }
        return res.status(400).json({ error: `Room is already ${existingRoom.status}` });
      }
    }

    const roomDoc = querySnap.docs[0];
    const roomData = roomDoc.data();

    // 2. Check if already in participants list
    if (roomData.participants && roomData.participants[guestId]) {
      return res.status(200).json({
        roomId: roomDoc.id,
        roomCode
      });
    }

    // 3. Update room document in Firestore
    await roomDoc.ref.update({
      [`participants.${guestId}`]: {
        userId: guestId,
        ready: false,
        score: 0,
        testCasesPassed: 0,
        progress: 0,
        solved: false,
        bestCode: ""
      }
    });

    console.log(`[POST /api/rooms/join] Guest ${guestId} joined room ${roomDoc.id} (code ${roomCode})`);

    return res.status(200).json({
      roomId: roomDoc.id,
      roomCode
    });
  } catch (error) {
    console.error("[POST /api/rooms/join] Error:", error.message);
    return res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

const { internalAuth } = require("../middlewares/internalAuth");

/**
 * POST /api/rooms/create-internal
 *
 * Internal-only endpoint called by the Realtime Server when a matchmaker
 * pair is found. Creates a room pre-populated with both players and sets
 * status to "active" so they jump straight into the duel.
 *
 * Protected by x-internal-secret header (no Firebase Auth).
 *
 * Body:   { player1Id, player2Id }
 * Returns { roomId }
 */
router.post("/create-internal", internalAuth, async (req, res) => {
  const { player1Id, player2Id } = req.body;

  if (!player1Id || !player2Id) {
    return res.status(400).json({ error: "player1Id and player2Id are required" });
  }

  try {
    // 1. Pick a random problem (same logic as /create)
    const docRefs = await db.collection("problems").listDocuments();
    let problemId = "";

    if (docRefs.length > 0) {
      problemId = docRefs[Math.floor(Math.random() * docRefs.length)].id;
    } else {
      const testcaseRefs = await db.collection("problem_testcases").listDocuments();
      if (testcaseRefs.length === 0) {
        return res.status(404).json({ error: "No problems found in the database" });
      }
      problemId = testcaseRefs[Math.floor(Math.random() * testcaseRefs.length)].id;
    }

    // 2. Generate a unique roomCode (same logic as /create)
    let roomCode = "";
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      roomCode = generateRoomCode();
      const querySnap = await db.collection("rooms")
        .where("roomCode", "==", roomCode)
        .limit(1)
        .get();
      if (querySnap.empty) isUnique = true;
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ error: "Failed to generate a unique room code" });
    }

    // 3. Build participant stubs for both players
    const participantStub = (uid) => ({
      userId: uid,
      ready: true,          // matched players are implicitly ready
      score: 0,
      testCasesPassed: 0,
      progress: 0,
      solved: false,
      bestCode: "",
    });

    const roomDoc = {
      roomCode,
      creatorId: player1Id,   // player1 is the nominal host
      problemId,
      status: "active",       // skips "waiting" — match already confirmed
      matchId: null,
      startedAt: FieldValue.serverTimestamp(),
      completedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      participants: {
        [player1Id]: participantStub(player1Id),
        [player2Id]: participantStub(player2Id),
      },
    };

    const docRef = await db.collection("rooms").add(roomDoc);

    console.log(
      `[POST /api/rooms/create-internal] Created room ${docRef.id} ` +
      `(${roomCode}) for ${player1Id} vs ${player2Id} — problem: ${problemId}`
    );

    return res.status(201).json({ roomId: docRef.id });
  } catch (error) {
    console.error("[POST /api/rooms/create-internal] Error:", error.message);
    return res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

module.exports = router;

