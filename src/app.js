require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Initializing Firebase Admin SDK early
const { db } = require("./config/firebase");

const app = express();

// Configure CORS
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

// Body Parser
app.use(express.json());

// Basic Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health check endpoint verifying Firebase connectivity
app.get("/health", async (req, res) => {
  try {
    // Simple doc read to verify Firestore connectivity
    // (listCollections() requires elevated IAM and often fails with NOT_FOUND)
    await db.collection("problem_testcases").limit(1).get();
    res.status(200).json({
      status: "UP",
      firebase: "CONNECTED",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check Firestore error:", error.message);
    res.status(500).json({
      status: "DOWN",
      firebase: "ERROR",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ── API Routes ──
const problemsRouter = require("./routes/problems");
app.use("/api/problems", problemsRouter);

// Fallback Route
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

module.exports = app;
