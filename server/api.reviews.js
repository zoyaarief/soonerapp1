// server/api.reviews.js
import express from "express";
import { getDb } from "./db.js";

const router = express.Router();

/**
 * GET /api/reviews/:venueId
 * Fetch all reviews for a venue
 */
router.get("/:venueId", async (req, res) => {
  const db = getDb();
  const { venueId } = req.params;

  const reviews = await db
    .collection("reviews")
    .find({ venueId })
    .sort({ createdAt: -1 })
    .toArray();

  res.json(reviews);
});

/**
 * POST /api/reviews/:venueId
 * Add a new review (only if user was served)
 */
router.post("/:venueId", async (req, res) => {
  const db = getDb();
  const userId = req.session?.userId;
  const name = req.session?.name || "Customer";
  const { venueId } = req.params;
  const { rating, comments } = req.body;

  if (!userId) return res.status(401).send("Unauthorized");

  // Only allow reviewing if user was served
  const served = await db.collection("activitylog").findOne({
    userId,
    venueId,
    action: "served",
  });
  if (!served)
    return res.status(403).send("You can review only after being served.");

  const now = new Date();

  await db.collection("reviews").insertOne({
    userId,
    name,
    venueId,
    rating,
    comments,
    createdAt: now,
    updatedAt: now,
  });

  res.json({ ok: true });
});

export default router;
