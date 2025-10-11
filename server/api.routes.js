import express from "express";
import { getDb } from "./db.js";

const api = express.Router();
api.use(express.json());

// ---------- Auth helpers ----------
function requireCustomer(req, res, next) {
  if (req.session?.user && req.session.user.role === "customer") return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ---------- Venues ----------
api.get("/venues", async (req, res) => {
  try {
    const db = getDb();
    let { type, q, city, price, rating, cuisine, limit = 20 } = req.query;

    // Normalize type (accept plural/singular)
    const map = {
      restaurants: "restaurant",
      restaurant: "restaurant",
      salons: "salon",
      salon: "salon",
      clinics: "clinic",
      clinic: "clinic",
      events: "event",
      event: "event",
      others: "other",
      other: "other",
    };
    if (typeof type === "string") {
      type = map[type.toLowerCase()] || type;
    }

    // Build filter safely (ignore empty / undefined / 'undefined')
    const filter = {};
    if (type && type !== "undefined" && type !== "null") {
      filter.category = type;
    }
    if (q && q.trim()) {
      filter.$or = [
        { name: new RegExp(q.trim(), "i") },
        { cuisine: new RegExp(q.trim(), "i") },
      ];
    }
    if (city && city.trim()) {
      const rx = new RegExp(city.trim(), "i");
      // match either top-level "city" OR nested "location.city"
      filter.$and = (filter.$and || []).concat([{ $or: [{ city: rx }, { "location.city": rx }] }]);
    }
    if (price && price !== "undefined" && !Number.isNaN(Number(price))) {
      filter.price = Number(price);
    }
    if (rating && rating !== "undefined" && !Number.isNaN(Number(rating))) {
      filter.rating = { $gte: Number(rating) };
    }
    if (cuisine && cuisine.trim()) {
      filter.cuisine = new RegExp(cuisine.trim(), "i");
    }

    const items = await db
      .collection("venues")
      .find(filter)
      .sort({ rating: -1 })
      .limit(Number(limit))
      .toArray();

    // Debug line (temporary): see what browse is sending
    console.log("[/api/venues] query:", req.query, "filter:", filter, "returned:", items.length);

    res.json(items);
  } catch (err) {
    console.error("Error fetching venues:", err);
    res.status(500).json({ error: "Failed to fetch venues" });
  }
});


api.get("/venues/:id", async (req, res) => {
  const db = getDb();
  const venueId = req.params.id;
  const venue = await db.collection("venues").findOne({ _id: venueId });
  if (!venue) return res.status(404).json({ error: "Not found" });

  const waiting = await db.collection("queue").countDocuments({ venueId, status: "waiting" });
  res.json({ ...venue, waiting });
});

// ---------- Likes / Favorites ----------
api.get("/likes", requireCustomer, async (req, res) => {
  const db = getDb();
  const likes = await db.collection("likes")
    .find({ userId: req.session.user.id })
    .toArray();
  res.json(likes);
});

api.post("/likes/:venueId", requireCustomer, async (req, res) => {
  const db = getDb();
  const doc = {
    userId: req.session.user.id,
    venueId: req.params.venueId,
    createdAt: new Date()
  };
  await db.collection("likes").updateOne(
    { userId: doc.userId, venueId: doc.venueId },
    { $setOnInsert: doc },
    { upsert: true }
  );
  res.json({ ok: true });
});

api.delete("/likes/:venueId", requireCustomer, async (req, res) => {
  const db = getDb();
  await db.collection("likes").deleteOne({
    userId: req.session.user.id,
    venueId: req.params.venueId
  });
  res.json({ ok: true });
});

// ---------- Queue ----------
api.get("/queue/active", requireCustomer, async (req, res) => {
  const db = getDb();
  const q = await db.collection("queue").findOne({
    userId: req.session.user.id,
    status: "waiting"
  });
  res.json(q || null);
});

// compute next order atomically per venue
async function nextOrder(db, venueId) {
  const r = await db.collection("settings").findOneAndUpdate(
    { _id: `seq:order:${venueId}` },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return r.value.value || 1;
}

api.post("/queue/:venueId/join", requireCustomer, async (req, res) => {
  const db = getDb();
  const { people = 2 } = req.body;
  const venueId = req.params.venueId;

  // deny if already in queue
  const existing = await db.collection("queue").findOne({
    userId: req.session.user.id,
    status: "waiting"
  });
  if (existing) return res.status(400).json({ error: "Already in a queue" });

  const order = await nextOrder(db, venueId);
  const doc = {
    userId: req.session.user.id,
    venueId,
    people: Math.max(1, Math.min(12, Number(people))),
    status: "waiting",
    order,
    createdAt: new Date()
  };
  await db.collection("queue").insertOne(doc);

  await db.collection("activitylog").insertOne({
    userId: doc.userId,
    venueId,
    type: "queue.entered",
    at: new Date(),
    meta: { people: doc.people, order }
  });

  res.json({ ok: true, order });
});

api.post("/queue/:venueId/cancel", requireCustomer, async (req, res) => {
  const db = getDb();
  const venueId = req.params.venueId;

  const q = await db.collection("queue").findOne({
    userId: req.session.user.id, venueId, status: "waiting"
  });
  if (!q) return res.status(404).json({ error: "No active queue" });

  await db.collection("queue").updateOne({ _id: q._id }, { $set: { status: "canceled" } });
  await db.collection("activitylog").insertOne({
    userId: q.userId, venueId, type: "queue.canceled", at: new Date(), meta: { order: q.order }
  });

  res.json({ ok: true });
});

// when user is <=5, client can call "arrived" (pause timer)
api.post("/queue/:venueId/arrived", requireCustomer, async (req, res) => {
  const db = getDb();
  const doc = await db.collection("queue").findOne({
    userId: req.session.user.id,
    venueId: req.params.venueId,
    status: "waiting"
  });
  if (!doc) return res.status(404).json({ error: "No active queue" });

  await db.collection("queue").updateOne(
    { _id: doc._id },
    { $set: { timerPaused: true } }
  );
  res.json({ ok: true });
});

// when owner lets them in (owner side will set status: served)
api.post("/queue/:venueId/served", requireCustomer, async (req, res) => {
  const db = getDb();
  const q = await db.collection("queue").findOne({
    userId: req.session.user.id, venueId: req.params.venueId, status: "waiting"
  });
  if (!q) return res.status(404).json({ error: "No active queue" });

  await db.collection("queue").updateOne({ _id: q._id }, { $set: { status: "served" } });
  await db.collection("activitylog").insertOne({
    userId: q.userId, venueId: q.venueId, type: "queue.served", at: new Date(), meta: { order: q.order }
  });
  res.json({ ok: true });
});

// ---------- Announcements for dashboard ----------
api.get("/announcements/active", async (req, res) => {
  const now = new Date();
  const db = getDb();
  const items = await db.collection("announcements").find({
    $or: [
      { startsAt: { $lte: now }, endsAt: { $gte: now } },
      { startsAt: { $exists: false }, endsAt: { $exists: false } }
    ]
  }).limit(3).toArray();
  res.json(items);
});

export default api;
