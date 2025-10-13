import express from "express";
import { getDb } from "./db.js";
import { ObjectId } from "mongodb";
import bcrypt from "bcrypt";
import likesApi from "./api.likes.js";
import reviewsApi from "./api.reviews.js";
import historyApi from "./api.history.js";

const api = express.Router();
api.use(express.json());

// ---------- Customer Auth ----------
api.post("/customers/signup", async (req, res) => {
  try {
    const db = getDb();
    const { name, email, password } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const existing = await db.collection("customers").findOne({ email: email.trim().toLowerCase() });
    if (existing) return res.status(409).json({ error: "Email already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      createdAt: new Date(),
    };
    const result = await db.collection("customers").insertOne(doc);

    // create session
    req.session.user = { id: String(result.insertedId), role: "customer", name: doc.name, email: doc.email };
    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error("Customer signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

api.post("/customers/login", async (req, res) => {
  try {
    const db = getDb();
    const { email, password } = req.body || {};
    if (!email?.trim() || !password) return res.status(400).json({ error: "Missing email/password" });

    const user = await db.collection("customers").findOne({ email: email.trim().toLowerCase() });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.customerId = String(user._id);
      req.session.customerName = user.name;
      req.session.user = {
        id: String(user._id),
        role: "customer",
        name: user.name,
        email: user.email
        };
      req.session.save(err2 => {
        if (err2) return res.status(500).json({ error: "Session save error" });
        res.json({ ok: true, user: { id: user._id, name: user.name, email: user.email } });
      });
    });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

api.get("/customers/me", async (req, res) => {
  if (!req.session?.customerId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const db = getDb();
  const cust = await db.collection("customers").findOne(
    { _id: new ObjectId(req.session.customerId) },
    { projection: { passwordHash: 0 } }
  );
  if (!cust) return res.status(404).json({ error: "Customer not found" });

  res.json({
    id: cust._id,
    name: cust.name,
    email: cust.email,
    phone: cust.phone || "",
    avatar: cust.avatar || "",
  });
});

api.post("/customers/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sooner.sid");
    res.json({ ok: true });
  });
});

// for checking in who's logged in
api.get("/customers/session", (req, res) => {
  if (req.session?.user) return res.json({ ok: true, user: req.session.user });
  res.status(401).json({ ok: false });
});

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
  //const venue = await db.collection("venues").findOne({ _id: venueId });
  const query = ObjectId.isValid(venueId)
  ? { _id: new ObjectId(venueId) }
  : { _id: venueId };

const venue = await db.collection("venues").findOne(query);
  if (!venue) return res.status(404).json({ error: "Not found" });

  const waiting = await db.collection("queue").countDocuments({ venueId, status: "waiting" });
  res.json({ ...venue, waiting });
});

// ===================== OWNERS PUBLIC ENDPOINTS (replaces /api/venues) =====================

// list all owners (public view) WITH search + filters
api.get("/owners/public", async (req, res) => {
  try {
    const db = getDb();

    // incoming filters from browse.js UI
    const {
      type = "",
      q = "",
      city = "",
      price = "",
      rating = "",
      cuisine = ""
    } = req.query;

    const filter = {};

    // Type: exact type match, case-insensitive (e.g., "Restaurant", "Salon")
    if (type) {
      filter.type = { $regex: new RegExp(`^${type}$`, "i") };
    }

    // Text search across name/description/features/cuisine/location
    if (q) {
      const rx = new RegExp(q, "i");
      filter.$or = [
        { business: rx },
        { "profile.displayName": rx },
        { "profile.description": rx },
        { "profile.features": rx },
        { "profile.cuisine": rx },
        { "profile.location": rx }
      ];
    }

    // City/location contains
    if (city) {
      filter["profile.location"] = { $regex: new RegExp(city, "i") };
    }

    // Cuisine contains
    if (cuisine) {
      filter["profile.cuisine"] = { $regex: new RegExp(cuisine, "i") };
    }

    // Price: our data keeps "approxPrice" as free text (e.g., "2 people . $50")
    // so we do a loose regex match rather than numeric compare
    if (price) {
      filter["profile.approxPrice"] = { $regex: new RegExp(price, "i") };
    }

    // Rating: try numeric >= if possible, otherwise ignore
    const minRating = parseFloat(rating);
    if (!Number.isNaN(minRating)) {
      filter["profile.rating"] = { $gte: minRating };
    }

    const owners = await db.collection("owners").find(filter, {
      projection: {
        manager: 0,
        email: 0,
        passwordHash: 0,
        phone: 0
      }
    })
    // we can tweak sorting preference here:
    // .sort({ "profile.rating": -1, "profile.displayName": 1 })
    .toArray();

    // flatten display info from profile
    const list = owners.map((o) => {
      const p = o.profile || {};
      return {
        _id: String(o._id),
        name: p.displayName || o.business || "Unnamed",
        description: p.description || "",
        city: p.location || "",
        cuisine: p.cuisine || "",
        approxPrice: p.approxPrice || "",
        rating: p.rating ?? "—",
        heroImage: p.avatar || "",
        features: p.features || "",
        type: o.type || "",
        openTime: p.openTime || "",
        closeTime: p.closeTime || ""
      };
    });

    res.json(list);
  } catch (err) {
    console.error("Error fetching owners (public with filters):", err);
    res.status(500).json({ error: "Server error" });
  }
});

// get single owner for place page
api.get("/owners/public/:id", async (req, res) => {
  try {
    const db = getDb();
    const id = req.params.id;

    const query = ObjectId.isValid(id)
      ? { _id: new ObjectId(id) }
      : { _id: id };

    const o = await db.collection("owners").findOne(query, {
      projection: { passwordHash: 0, email: 0, phone: 0 },
    });

    if (!o) return res.status(404).json({ error: "Not found" });

    const p = o.profile || {};
    res.json({
      _id: String(o._id),
      name: p.displayName || o.business || "Unnamed",
      description: p.description || "",
      cuisine: p.cuisine || "",
      approxPrice: p.approxPrice || "",
      location: p.location || "",
      features: p.features || "",
      openTime: p.openTime || "",
      closeTime: p.closeTime || "",
      waitTime: p.waitTime || "",
      totalSeats: p.totalSeats || "",
      heroImage: p.avatar || "",
      gallery: p.gallery || [],
      rating: p.rating || "—",
      type: o.type || "",
    });
  } catch (err) {
    console.error("Error fetching single owner:", err);
    res.status(500).json({ error: "Server error" });
  }
});
// ===================== END OWNERS PUBLIC ENDPOINTS =====================

// --- Active queue for the logged-in customer ---
api.get("/queue/active", async (req, res) => {
  try {
    const db = getDb();
    const customerId = req.session?.customerId;
    if (!customerId) return res.status(204).end(); // no user -> treat as no queue

    // Find the most recent "waiting" queue entry
    const q = await db.collection("queue").findOne(
      { customerId: String(customerId), status: { $in: ["waiting", "joined"] } },
      { sort: { joinedAt: -1 } }
    );
    if (!q) return res.status(204).end();

    // Compute position within that venue's active queue
    const venueId = String(q.venueId);
    const all = await db.collection("queue")
      .find({ venueId, status: { $in: ["waiting", "joined"] } })
      .sort({ joinedAt: 1 })
      .toArray();

    const index = all.findIndex(x => String(x._id) === String(q._id));
    const position = index >= 0 ? index + 1 : null;

    // Approx wait: 8 min per party by default; prefer owner_settings.avgWaitMins if set.
    const settings = await db.collection("owner_settings").findOne({ venueId });
    const avgPerParty = Number(settings?.avgWaitMins) || 8;
    const approxWaitMins = position ? position * avgPerParty : null;

    // Venue display name
    const venue = await db.collection("owners").findOne(
      { _id: ObjectId.isValid(venueId) ? new ObjectId(venueId) : venueId },
      { projection: { business: 1, "profile.displayName": 1 } }
    );

    res.json({
      venueId,
      venueName: venue?.profile?.displayName || venue?.business || "—",
      position,
      people: Number(q.people || 1),
      approxWaitMins
    });
  } catch (err) {
    console.error("GET /queue/active error:", err);
    res.status(204).end(); // hide section on any failure
  }
});

// Public venue metrics (for place page)
api.get("/queue/metrics/:venueId", async (req, res) => {
  try {
    const db = getDb();
    const raw = req.params.venueId;
    const venueId = ObjectId.isValid(raw) ? new ObjectId(raw) : raw;

    // owner settings (open/closed, walk-ins, seats, avg wait)
    const settings = await db.collection("owner_settings").findOne({ venueId });

    // active queue (validator enum: "active","served","cancelled","no_show")
    const active = await db.collection("queue")
      .find({ venueId, status: "active" })
      .sort({ joinedAt: 1 })
      .toArray();

    const count = active.length;
    const totalPeople = active.reduce((sum, q) => sum + Number(q.partySize || q.people || 1), 0);

    const avgPerParty = Number(settings?.avgWaitMins) || 8; // minutes per party
    const approxWaitMins = count ? count * avgPerParty : 0;

    const totalSeats = Number(settings?.totalSeats || 0);
    const seatsUsed = Math.min(totalPeople, totalSeats || totalPeople);
    const spotsLeft = totalSeats ? Math.max(0, totalSeats - totalPeople) : null;

    // try to compute position for the current customer (or allow override for testing)
    const customerId = req.query.customerId || req.session?.customerId;
    let position = null;
    if (customerId) {
      const idx = active.findIndex(x => String(x.customerId) === String(customerId));
      position = idx >= 0 ? idx + 1 : null;
    }

    res.json({
      openStatus: settings?.openStatus || "closed",
      walkinsEnabled: !!settings?.walkinsEnabled,
      queueActive: settings?.queueActive !== false,
      count,
      totalPeople,
      approxWaitMins,
      position,
      capacity: {
        totalSeats,
        seatsUsed,
        spotsLeft
      }
    });
  } catch (err) {
    console.error("GET /api/queue/metrics/:venueId error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Likes for the customer (or ?customerId= override) ---
api.get("/likes", async (req, res) => {
  try {
    const db = getDb();
    const customerId = req.query.customerId || req.session?.customerId;
    if (!customerId) return res.json([]);

    const rows = await db.collection("likes")
      .find({ customerId: customerId, liked: { $ne: false } })
      .project({ venueId: 1, _id: 0 })
      .toArray();

    // normalize venueId to string
    const out = rows.map(r => ({
      venueId: r.venueId && r.venueId._bsontype === "ObjectID"
        ? String(r.venueId)
        : String(r.venueId)
    }));
    res.json(out);
  } catch (err) {
    console.error("GET /likes error:", err);
    res.json([]);
  }
});

// --- History summary (or ?customerId= override) ---
api.get("/history", async (req, res) => {
  try {
    const db = getDb();
    const customerId = req.query.customerId || req.session?.customerId;
    if (!customerId) return res.json([]);

    const since = new Date();
    since.setDate(since.getDate() - 90);

    const agg = await db.collection("activitylog").aggregate([
      {
        $match: {
          customerId: customerId,
          createdAt: { $gte: since },
          action: { $in: ["served", "visited", "joined"] }
        }
      },
      { $group: { _id: "$venueId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 12 }
    ]).toArray();

    const out = agg.map(a => ({
      venueId: a._id && a._id._bsontype === "ObjectID" ? String(a._id) : String(a._id),
      count: a.count
    }));
    res.json(out);
  } catch (err) {
    console.error("GET /history error:", err);
    res.json([]);
  }
});

api.get("/owner_settings/:venueId", async (req, res) => {
  try {
    const db = getDb();
    const s = await db
      .collection("owner_settings")
      .findOne({ venueId: req.params.venueId });
    if (!s) return res.status(404).json({ error: "Settings not found" });
    res.json(s);
  } catch (err) {
    console.error("Error fetching owner settings:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- Queue ----------
// --- Active queue for the logged-in customer (or ?customerId= for testing) ---
api.get("/queue/active", async (req, res) => {
  try {
    const db = getDb();

    // allow manual override: /api/queue/active?customerId=68eabb67f83cd1758cbaff78
    const sessionId = req.session?.customerId;
    const override = req.query.customerId;
    const customerId = override || sessionId;

    // If still no customer, hide section
    if (!customerId) return res.status(204).end();

    // Your validator says enum is: ["active","served","cancelled","no_show"]
    const q = await db.collection("queue").findOne(
      { customerId: customerId, status: "active" },
      { sort: { joinedAt: -1 } }
    );
    if (!q) return res.status(204).end();

    const venueId = (q.venueId && q.venueId._bsontype === "ObjectID")
      ? q.venueId
      : (ObjectId.isValid(q.venueId) ? new ObjectId(q.venueId) : q.venueId);

    // Position among active entries ordered by joinedAt
    const all = await db.collection("queue")
      .find({ venueId, status: "active" })
      .sort({ joinedAt: 1 })
      .project({ _id: 1 })
      .toArray();

    const index = all.findIndex(x => String(x._id) === String(q._id));
    const position = index >= 0 ? index + 1 : null;

    // Approx wait from owner_settings
    const settings = await db.collection("owner_settings").findOne({ venueId });
    const avgPerParty = Number(settings?.avgWaitMins) || 8;
    const approxWaitMins = position ? position * avgPerParty : null;

    // Venue display name
    const venue = await db.collection("owners").findOne(
      { _id: venueId },
      { projection: { business: 1, "profile.displayName": 1 } }
    );

    res.json({
      venueId: String(venueId),
      venueName: venue?.profile?.displayName || venue?.business || "—",
      position,
      people: Number(q.partySize || q.people || 1),
      approxWaitMins
    });
  } catch (err) {
    console.error("GET /queue/active error:", err);
    res.status(204).end();
  }
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

  // fetch owner settings for this venue
  const settings = await db.collection("owner_settings").findOne({ venueId });
  if (
    !settings ||
    !settings.walkinsEnabled ||
    settings.openStatus !== "open" ||
    !settings.queueActive
  ) {
    return res.status(403).json({ error: "Queue not active" });
  }

  // deny if already in queue
  const existing = await db.collection("queue").findOne({
    userId: req.session.user.id,
    status: "waiting"
  });
  if (existing) return res.status(400).json({ error: "Already in a queue" });

const order = await nextOrder(db, venueId);
const count = Math.max(1, Math.min(12, Number(people)));
const doc = {
  userId: req.session.user.id,
  venueId,
  people: count,
  partySize: count,      // bridge for owner dashboard compatibility
  status: "waiting",
  order,
  position: order,       // bridge for owner dashboard
  joinedAt: new Date(),  // bridge field
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

// Get announcement for a specific venue (public)
// Public: get announcement for a specific venue or restaurant
api.get("/announcements/venue/:venueId", async (req, res) => {
  try {
    const db = getDb();
    const venueId = req.params.venueId;

    const query = {
      $or: [
        { restaurantId: venueId },
        { venueId: venueId }
      ],
      visible: true
    };

    const ann = await db.collection("announcements").findOne(query, { sort: { createdAt: -1 } });
    if (!ann) return res.status(404).json({}); // silently ignore when none
    res.json({
      id: ann._id,
      message: ann.message,
      type: ann.type || "announcement",
      createdAt: ann.createdAt
    });
  } catch (e) {
    console.error("Error fetching announcement:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Latest reviews for a venue (public)
api.get("/reviews/venue/:venueId", async (req, res) => {
  try {
    const db = getDb();
    const raw = req.params.venueId;
    const venueId = ObjectId.isValid(raw) ? new ObjectId(raw) : raw;

    // compute average + count
    const stats = await db.collection("reviews").aggregate([
      { $match: { venueId } },
      { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } }
    ]).toArray();

    const avgRating = stats[0]?.avg ?? null;
    const total = stats[0]?.count ?? 0;

    // pull latest N reviews
    const reviews = await db.collection("reviews")
      .find({ venueId })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    // (optional) resolve customer names from customers collection
    const customersMap = new Map();
    for (const r of reviews) {
      const cid = r.customerId && r.customerId._bsontype === "ObjectID" ? r.customerId : (ObjectId.isValid(r.customerId) ? new ObjectId(r.customerId) : null);
      if (cid && !customersMap.has(String(cid))) {
        const cust = await db.collection("customers").findOne({ _id: cid }, { projection: { name: 1, email: 1 } });
        customersMap.set(String(cid), cust?.name || "");
      }
    }

    res.json({
      avgRating,
      total,
      items: reviews.map(r => ({
        _id: String(r._id),
        rating: r.rating,
        comment: r.comment || "",
        customerName: customersMap.get(String(r.customerId)) || "",
        createdAt: r.createdAt
      }))
    });
  } catch (err) {
    console.error("GET /api/reviews/venue/:venueId error:", err);
    res.json({ avgRating: null, total: 0, items: [] });
  }
});

api.use("/likes", likesApi);
api.use("/reviews", reviewsApi);
api.use("/history", historyApi);

export default api;
