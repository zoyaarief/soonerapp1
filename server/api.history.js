// server/api.history.js

/*
import express from "express";
import { getDb } from "./db.js";

const router = express.Router();

/**
 * GET /api/history
 * Returns all venues where the user has been marked as 'served'
 */

/*router.get("/", async (req, res) => {
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

export default router; */

// server/api.history.js
import express from "express";
import { getDb } from "./db.js";
import { ObjectId } from "mongodb";

const router = express.Router();

/**
 * GET /api/history
 * Returns venues where the user has been marked as 'served'
 */
router.get("/", async (req, res) => {
  const db = getDb();
  const user = req.session?.user;
  if (!user) return res.status(401).send("Unauthorized");

  // The worker + server write type: "queue.served"
  const servedLogs = await db
    .collection("activitylog")
    .find({ userIdStr: user.id, type: "queue.served" })
    .sort({ at: -1 })
    .toArray();

  const venueIds = [
    ...new Set(servedLogs.map((l) => String(l.venueIdStr || l.venueId))),
  ];

  // Try both ObjectId and string lookups
  const asObj = venueIds.filter(ObjectId.isValid).map((id) => new ObjectId(id));
  const owners = await db
    .collection("owners")
    .find(
      {
        $or: [
          { _id: { $in: asObj } },
          { _id: { $in: venueIds } }, // legacy string ids
        ],
      },
      { projection: { business: 1, profile: 1 } }
    )
    .toArray();

  const history = servedLogs.map((l) => {
    const v =
      owners.find((v) => String(v._id) === String(l.venueIdStr || l.venueId)) ||
      {};
    const name = v?.profile?.displayName || v?.business || "Venue";
    return {
      venueId: l.venueIdStr || l.venueId,
      name,
      date: l.at,
    };
  });

  res.json(history);
});

export default router;
