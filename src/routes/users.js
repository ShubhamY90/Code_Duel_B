const express = require("express");
const router  = express.Router();
const { db }  = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");

/**
 * POST /api/users/init
 *
 * Called by the frontend immediately after Firebase Auth sign-in.
 * Creates the user document only if it doesn't already exist,
 * so repeat logins never overwrite the rating or stats.
 *
 * Body: { uid, displayName, email, photoURL }
 */
router.post("/init", async (req, res) => {
    const { uid, displayName, email, photoURL } = req.body;

    if (!uid || !email) {
        return res.status(400).json({ error: "uid and email are required" });
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
            matchesPlayed: 0,
            matchesWon:    0,
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

module.exports = router;
