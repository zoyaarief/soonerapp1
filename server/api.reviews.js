import express from "express";
import { ObjectId } from "mongodb";   // ✅ make sure this is imported
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
 */
router.post("/:venueId", async (req, res) => {
  const db = getDb();
  const user = req.session?.user; // ✅ you set this during login
  if (!user) return res.status(401).send("Unauthorized");

  const { venueId } = req.params;
  const { rating, comments } = req.body;

  const now = new Date();
  await db.collection("reviews").insertOne({
    userId: user.id, // ✅ same field used below in PUT check
    name: user.name || "Customer",
    venueId: String(venueId),
    rating: Number(rating) || 5,
    comments: comments || "",
    createdAt: now,
    updatedAt: now,
  });

  res.json({ ok: true });
});

/**
 * PUT /api/reviews/:reviewId
 */
router.put("/:reviewId", async (req, res) => {
  const db = getDb();

  // ✅ use same session field as POST
  const user = req.session?.user;
  if (!user) return res.status(401).send("Unauthorized");

  const { reviewId } = req.params;
  const { rating, comments } = req.body;

  const existing = await db
    .collection("reviews")
    .findOne({ _id: new ObjectId(reviewId) });

  if (!existing) return res.status(404).send("Review not found");

  // ✅ compare with same field stored in DB
  if (String(existing.userId) !== String(user.id))
    return res.status(403).send("Cannot edit another user's review");

  await db.collection("reviews").updateOne(
    { _id: existing._id },
    {
      $set: {
        rating: Number(rating) || 5,
        comments: comments || "",
        updatedAt: new Date(),
      },
    }
  );

  res.json({ ok: true, updated: true });
});

/**
 * DELETE /api/reviews/:reviewId
 * Only the review’s author can delete it
 */
router.delete("/:reviewId", async (req, res) => {
  const db = getDb();
  const user = req.session?.user;
  if (!user) return res.status(401).send("Unauthorized");

  const { reviewId } = req.params;

  const existing = await db
    .collection("reviews")
    .findOne({ _id: new ObjectId(reviewId) });

  if (!existing) return res.status(404).send("Review not found");

  if (String(existing.userId) !== String(user.id))
    return res.status(403).send("Cannot delete another user's review");

  await db.collection("reviews").deleteOne({ _id: existing._id });

  res.json({ ok: true, deleted: true });
});

export default router;
