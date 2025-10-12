// server/api.history.js
import express from "express";
import { getDb } from "./db.js";

const router = express.Router();

/**
 * GET /api/history
 * Returns all venues where the user has been marked as 'served'
 */
router.get("/", async (req, res) => {
  const db = getDb();
  const userId = req.session?.userId;
  if (!userId) return res.status(401).send("Unauthorized");

  // Find all 'served' records for the user
  const servedLogs = await db
    .collection("activitylog")
    .find({ userId, action: "served" })
    .sort({ at: -1 })
    .toArray();

  // Map to unique venueIds
  const venueIds = [...new Set(servedLogs.map(l => l.venueId))];

  // Fetch basic venue info
  const venues = await db
    .collection("venues")
    .find({ _id: { $in: venueIds } })
    .project({ name: 1, profile: 1 })
    .toArray();

  // Merge details
  const history = servedLogs.map(l => {
    const v = venues.find(v => String(v._id) === String(l.venueId)) || {};
    return {
      venueId: l.venueId,
      name: v.name || v.profile?.displayName || "Venue",
      date: l.at,
    };
  });

  res.json(history);
});

export default router;