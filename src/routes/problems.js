const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

/**
 * Shared helper — reads both Firestore collections and merges them.
 *
 * - problems/{problemId}          → metadata (title, difficulty, etc.)
 * - problem_testcases/{problemId} → sampleTestCases (hiddenTestCases excluded)
 *
 * If the problems doc is missing, we still return testcases + empty metadata
 * so the UI doesn't completely break while the problems collection is being
 * populated.
 *
 * Returns null only when NEITHER collection has a doc for this problemId.
 */
async function buildProblemResponse(problemId) {
  const [problemSnap, testcasesSnap] = await Promise.all([
    db.collection("problems").doc(problemId).get(),
    db.collection("problem_testcases").doc(problemId).get(),
  ]);

  // Neither doc exists — nothing to return
  if (!problemSnap.exists && !testcasesSnap.exists) {
    console.warn(`[buildProblemResponse] No data found for problemId: ${problemId}`);
    return null;
  }

  const problemData = problemSnap.exists ? problemSnap.data() : {};

  // Normalize sampleTestCases
  const rawCases = testcasesSnap.exists
    ? testcasesSnap.data().sampleTestCases ?? []
    : [];
  const sampleTestCases = rawCases.map((tc) => ({
    input: tc.input ?? "",
    output: tc.output ?? "",
    structuredInput: tc.structuredInput ?? tc.structured_input ?? null,
    explanation: tc.explanation ?? tc.explaination ?? "",
  }));

  // Normalize difficulty to Title Case ("easy" → "Easy")
  const rawDifficulty = problemData.difficulty ?? "Easy";
  const difficulty =
    rawDifficulty.charAt(0).toUpperCase() + rawDifficulty.slice(1).toLowerCase();

  if (!problemSnap.exists) {
    console.warn(`[buildProblemResponse] problems/${problemId} not found — returning testcases only`);
  }

  return {
    id: problemId,
    title: problemData.title ?? problemId,
    difficulty,                                    // already Title-Cased above
    rating: problemData.rating ?? 0,
    topic: problemData.topic ?? "",
    description: problemData.description ?? "",
    constraints: problemData.constraints ?? {},
    inputFormat: problemData.inputFormat ?? [],
    outputFormat: problemData.outputFormat ?? [],
    sampleTestCases,
  };
}

/**
 * GET /api/problems/random
 *
 * Lists problem IDs from problem_testcases (the guaranteed-to-exist collection),
 * picks one at random, then fetches and merges full data.
 * hiddenTestCases are NEVER returned.
 */
router.get("/random", async (req, res) => {
  try {
    console.log("[/random] listing documents from problem_testcases...");
    const docRefs = await db.collection("problem_testcases").listDocuments();
    console.log("[/random] found", docRefs.length, "problem(s):", docRefs.map(r => r.id));

    if (docRefs.length === 0) {
      return res.status(404).json({ error: "No problems found in the database" });
    }

    const randomRef = docRefs[Math.floor(Math.random() * docRefs.length)];
    const randomId = randomRef.id;
    console.log("[/random] selected:", randomId);

    const problem = await buildProblemResponse(randomId);
    console.log("[/random] built response:", problem ? `✓ ${problem.id}` : "null");

    if (!problem) {
      return res.status(404).json({ error: "Problem data not found", problemId: randomId });
    }

    return res.status(200).json(problem);
  } catch (error) {
    console.error("[GET /api/problems/random] Error:", error.message);
    return res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

/**
 * GET /api/problems/:problemId
 *
 * Reads from:
 *   - problems/{problemId}          → metadata, description, constraints, etc.
 *   - problem_testcases/{problemId} → sampleTestCases (public), hiddenTestCases (NOT returned)
 */
router.get("/:problemId", async (req, res) => {
  const { problemId } = req.params;

  try {
    const problem = await buildProblemResponse(problemId);

    if (!problem) {
      return res.status(404).json({ error: "Problem not found", problemId });
    }

    return res.status(200).json(problem);
  } catch (error) {
    console.error(`[GET /api/problems/${problemId}] Error:`, error.message);
    return res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

module.exports = router;
