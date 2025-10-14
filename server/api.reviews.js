// server/api.reviews.js
import express from "express";
import { getDb } from "./db.js";

const router = express.Router();

/**
 * GET /api/reviews/:venueId
 */
router.get("/:venueId", async (req, res) => {
  const db = getDb();
  const { venueId } = req.params;
  const reviews = await db
    .collection("reviews")
    .find({ venueId: String(venueId) })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(reviews);
});

/**
 * POST /api/reviews/:venueId
 * Only if the user was served
 */
router.post("/:venueId", async (req, res) => {
  const db = getDb();
  const user = req.session?.user;
  if (!user) return res.status(401).send("Unauthorized");

  const { venueId } = req.params;
  const { rating, comments } = req.body;

  // Must be served first
  const served = await db.collection("activitylog").findOne({
    userIdStr: user.id,
    venueIdStr: String(venueId),
    type: "queue.served",
  });
  if (!served)
    return res.status(403).send("You can review only after being served.");

  const now = new Date();
  await db.collection("reviews").insertOne({
    userId: user.id,
    name: user.name || "Customer",
    venueId: String(venueId),
    rating: Number(rating) || 5,
    comments: comments || "",
    createdAt: now,
    updatedAt: now,
  });

  res.json({ ok: true });
});

export default router;
