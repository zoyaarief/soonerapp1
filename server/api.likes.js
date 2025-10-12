// server/api.likes.js
import express from "express";
import { getDb } from "./db.js";

const router = express.Router();

/**
 * GET /api/likes
 * Fetch all liked venues for the current user
 */
router.get("/", async (req, res) => {
  const db = getDb();
  const userId = req.session?.userId;
  if (!userId) return res.status(401).send("Unauthorized");

  const likes = await db.collection("likes").find({ userId }).toArray();
  res.json(likes);
});

/**
 * POST /api/likes/:venueId
 * Add a venue to the user’s favorites
 */
router.post("/:venueId", async (req, res) => {
  const db = getDb();
  const userId = req.session?.userId;
  const { venueId } = req.params;
  if (!userId) return res.status(401).send("Unauthorized");

  await db.collection("likes").updateOne(
    { userId, venueId },
    { $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  res.json({ ok: true });
});

/**
 * DELETE /api/likes/:venueId
 * Remove a venue from favorites
 */
router.delete("/:venueId", async (req, res) => {
  const db = getDb();
  const userId = req.session?.userId;
  const { venueId } = req.params;
  if (!userId) return res.status(401).send("Unauthorized");

  await db.collection("likes").deleteOne({ userId, venueId });
  res.json({ ok: true });
});

export default router;
