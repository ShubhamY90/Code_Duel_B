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
    // Attempt a light read to confirm database connectivity
    await db.listCollections();
    res.status(200).json({
      status: "UP",
      firebase: "CONNECTED",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check Firestore error:", error);
    res.status(500).json({
      status: "DOWN",
      firebase: "ERROR",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Fallback Route
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

module.exports = app;
