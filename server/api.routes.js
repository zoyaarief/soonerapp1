// server/api.routes.js
import express from "express";
import { getDb } from "./db.js";
import { ObjectId } from "mongodb";
import bcrypt from "bcrypt";
import likesApi from "./api.likes.js";
import reviewsApi from "./api.reviews.js";
import historyApi from "./api.history.js";

const api = express.Router();
api.use(express.json());

// ---------- Helpers ----------
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const asStr = (v) => (v == null ? "" : String(v));

// ---------- Customer Auth ----------
api.post("/customers/signup", async (req, res) => {
  try {
    const db = getDb();
    const { name, phone, email, username, password } = req.body || {};
    if (
      !name?.trim() ||
      !email?.trim() ||
      !username?.trim() ||
      !password ||
      password.length < 6
    ) {
      return res.status(400).json({ error: "Invalid input" });
    }

    // unique constraints
    const existing = await db.collection("customers").findOne({
      $or: [
        { email: email.trim().toLowerCase() },
        { username: username.trim().toLowerCase() },
      ],
    });
    if (existing)
      return res
        .status(409)
        .json({ error: "Email or username already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = {
      name: name.trim(),
      phone: asStr(phone).trim(),
      email: email.trim().toLowerCase(),
      username: username.trim().toLowerCase(),
      passwordHash,
      createdAt: new Date(),
    };
    const result = await db.collection("customers").insertOne(doc);

    req.session.user = {
      id: String(result.insertedId),
      role: "customer",
      name: doc.name,
      email: doc.email,
      username: doc.username,
    };
    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error("Customer signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

api.post("/customers/login", async (req, res) => {
  try {
    const db = getDb();
    const { username, email, password } = req.body || {};
    if (!(username || email) || !password)
      return res
        .status(400)
        .json({ error: "Missing username/email or password" });

    const query = username
      ? { username: username.trim().toLowerCase() }
      : { email: email.trim().toLowerCase() };

    const user = await db.collection("customers").findOne(query);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.customerId = String(user._id);
      req.session.customerName = user.name;
      req.session.user = {
        id: String(user._id),
        role: "customer",
        name: user.name,
        email: user.email,
        username: user.username,
      };
      req.session.save((err2) => {
        if (err2) return res.status(500).json({ error: "Session save error" });
        res.json({
          ok: true,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            username: user.username,
          },
        });
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
  const cust = await db
    .collection("customers")
    .findOne(
      { _id: new ObjectId(req.session.customerId) },
      { projection: { passwordHash: 0 } }
    );
  if (!cust) return res.status(404).json({ error: "Customer not found" });

  res.json({
    id: cust._id,
    name: cust.name,
    email: cust.email,
    username: cust.username,
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

api.get("/customers/session", (req, res) => {
  if (req.session?.user) return res.json({ ok: true, user: req.session.user });
  res.status(401).json({ ok: false });
});

// ---------- Auth helpers ----------
function requireCustomer(req, res, next) {
  if (req.session?.user && req.session.user.role === "customer") return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ---------- Venues (legacy — waiting count) ----------
api.get("/venues", async (req, res) => {
  try {
    const db = getDb();
    let { type, q, city, price, rating, cuisine, limit = 20 } = req.query;

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
    if (typeof type === "string") type = map[type.toLowerCase()] || type;

    const filter = {};
    if (type) filter.category = type;
    if (q && q.trim()) {
      filter.$or = [
        { name: new RegExp(escapeRegExp(q.trim()), "i") },
        { cuisine: new RegExp(escapeRegExp(q.trim()), "i") },
      ];
    }
    if (city && city.trim()) {
      const rx = new RegExp("^" + escapeRegExp(city.trim()), "i");
      filter.$and = (filter.$and || []).concat([
        { $or: [{ city: rx }, { "location.city": rx }] },
      ]);
    }
    if (price && !Number.isNaN(Number(price))) filter.price = Number(price);
    if (rating && !Number.isNaN(Number(rating)))
      filter.rating = { $gte: Number(rating) };
    if (cuisine && cuisine.trim())
      filter.cuisine = new RegExp("^" + escapeRegExp(cuisine.trim()), "i");

    const items = await db
      .collection("venues")
      .find(filter, { projection: { gallery: 0, bigBlob: 0 } })
      .sort({ rating: -1 })
      .limit(Number(limit))
      .toArray();

    res.json(items);
  } catch (err) {
    console.error("Error fetching venues:", err);
    res.status(500).json({ error: "Failed to fetch venues" });
  }
});

api.get("/venues/:id", async (req, res) => {
  const db = getDb();
  const venueId = String(req.params.id);

  const query = ObjectId.isValid(venueId)
    ? { _id: new ObjectId(venueId) }
    : { _id: venueId };
  const venue = await db.collection("venues").findOne(query);
  if (!venue) return res.status(404).json({ error: "Not found" });

  const waiting = await db
    .collection("queue")
    .countDocuments({ venueId: venueId, status: "waiting" });
  res.json({ ...venue, waiting });
});

// ===================== OWNERS PUBLIC =====================
api.get("/owners/public", async (req, res) => {
  try {
    const db = getDb();
    const {
      type = "",
      q = "",
      city = "",
      price = "",
      rating = "",
      cuisine = "",
      page = "1",
      limit = "24",
    } = req.query;

    const limitNum = Math.min(Number(limit) || 24, 100);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (type)
      filter.type = { $regex: new RegExp(`^${escapeRegExp(type)}$`, "i") };
    if (q) filter.$text = { $search: q };
    if (city)
      filter["profile.location"] = {
        $regex: new RegExp("^" + escapeRegExp(city), "i"),
      };
    if (cuisine)
      filter["profile.cuisine"] = {
        $regex: new RegExp("^" + escapeRegExp(cuisine), "i"),
      };
    if (price)
      filter["profile.approxPrice"] = {
        $regex: new RegExp(escapeRegExp(price), "i"),
      };

    const minRating = parseFloat(rating);
    if (!Number.isNaN(minRating))
      filter["profile.rating"] = { $gte: minRating };

    const cursor = db
      .collection("owners")
      .find(filter, {
        projection: {
          business: 1,
          type: 1,
          "profile.displayName": 1,
          "profile.description": 1,
          "profile.cuisine": 1,
          "profile.location": 1,
          "profile.approxPrice": 1,
          "profile.rating": 1,
          "profile.avatar": 1,
          "profile.openTime": 1,
          "profile.closeTime": 1,
          "profile.features": 1,
        },
      })
      .sort({ "profile.rating": -1, "profile.displayName": 1 })
      .skip(skip)
      .limit(limitNum);

    const [owners, total] = await Promise.all([
      cursor.toArray(),
      db.collection("owners").countDocuments(filter),
    ]);

    const items = owners.map((o) => {
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
        closeTime: p.closeTime || "",
      };
    });

    res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("Error fetching owners (public with filters):", err);
    res.status(500).json({ error: "Server error" });
  }
});

api.get("/owners/public/:id", async (req, res) => {
  try {
    const db = getDb();
    const id = String(req.params.id);
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

api.get("/owner_settings/:venueId", async (req, res) => {
  try {
    const db = getDb();
    const id = String(req.params.venueId);
    const asObj = ObjectId.isValid(id) ? new ObjectId(id) : null;

    const s = await db.collection("owner_settings").findOne({
      $or: [
        asObj && { ownerId: asObj },
        { ownerId: id },
        asObj && { venueId: asObj },
        { venueId: id },
      ].filter(Boolean),
    });

    if (!s) return res.status(404).json({ error: "Settings not found" });
    res.json({
      walkinsEnabled: !!s.walkinsEnabled,
      openStatus: s.openStatus === "open" ? "open" : "closed",
      queueActive: s.queueActive !== false,
    });
  } catch (err) {
    console.error("Error fetching owner settings:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- Queue ----------
api.get("/queue/active", requireCustomer, async (req, res) => {
  const db = getDb();
  const q = await db.collection("queue").findOne({
    userId: req.session.user.id,
    status: "waiting",
  });
  res.json(q || null);
});

// compute next order atomically per venue
async function nextOrder(db, venueId) {
  const r = await db
    .collection("settings")
    .findOneAndUpdate(
      { _id: `seq:order:${venueId}` },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: "after" }
    );
  return r.value.value || 1;
}

api.post("/queue/:venueId/join", requireCustomer, async (req, res) => {
  const db = getDb();
  const { people = 2 } = req.body;
  const venueId = String(req.params.venueId);

  const settings = await db
    .collection("owner_settings")
    .findOne({ ownerId: venueId });
  if (
    !settings ||
    !settings.walkinsEnabled ||
    settings.openStatus !== "open" ||
    !settings.queueActive
  ) {
    return res.status(403).json({ error: "Queue not active" });
  }

  const existing = await db.collection("queue").findOne({
    userId: req.session.user.id,
    status: "waiting",
  });
  if (existing) return res.status(400).json({ error: "Already in a queue" });

  const order = await nextOrder(db, venueId);
  const count = Math.max(1, Math.min(12, Number(people)));
  const doc = {
    userId: req.session.user.id,
    venueId, // store as string
    people: count,
    partySize: count,
    status: "waiting",
    order,
    position: order,
    joinedAt: new Date(),
    createdAt: new Date(),
  };
  await db.collection("queue").insertOne(doc);

  await db.collection("activitylog").insertOne({
    type: "queue.entered",
    at: new Date(),
    userIdStr: doc.userId,
    venueIdStr: venueId,
    meta: { people: doc.people, order },
  });

  res.json({ ok: true, order });
});

api.post("/queue/:venueId/cancel", requireCustomer, async (req, res) => {
  const db = getDb();
  const venueId = String(req.params.venueId);

  const q = await db.collection("queue").findOne({
    userId: req.session.user.id,
    venueId,
    status: "waiting",
  });
  if (!q) return res.status(404).json({ error: "No active queue" });

  await db
    .collection("queue")
    .updateOne(
      { _id: q._id },
      { $set: { status: "canceled", updatedAt: new Date() } }
    );
  await db.collection("activitylog").insertOne({
    type: "queue.canceled",
    at: new Date(),
    userIdStr: q.userId,
    venueIdStr: venueId,
    meta: { order: q.order },
  });

  res.json({ ok: true });
});

api.post("/queue/:venueId/arrived", requireCustomer, async (req, res) => {
  const db = getDb();
  const doc = await db.collection("queue").findOne({
    userId: req.session.user.id,
    venueId: String(req.params.venueId),
    status: "waiting",
  });
  if (!doc) return res.status(404).json({ error: "No active queue" });

  await db
    .collection("queue")
    .updateOne(
      { _id: doc._id },
      { $set: { timerPaused: true, updatedAt: new Date() } }
    );
  res.json({ ok: true });
});

api.post("/queue/:venueId/served", requireCustomer, async (req, res) => {
  const db = getDb();
  const venueId = String(req.params.venueId);
  const q = await db.collection("queue").findOne({
    userId: req.session.user.id,
    venueId,
    status: "waiting",
  });
  if (!q) return res.status(404).json({ error: "No active queue" });

  await db
    .collection("queue")
    .updateOne(
      { _id: q._id },
      { $set: { status: "served", updatedAt: new Date() } }
    );
  await db.collection("activitylog").insertOne({
    type: "queue.served",
    at: new Date(),
    userIdStr: q.userId,
    venueIdStr: venueId,
    meta: { order: q.order },
  });
  res.json({ ok: true });
});

// ---------- Announcements for dashboard ----------
api.get("/announcements/active", async (req, res) => {
  const now = new Date();
  const db = getDb();
  const items = await db
    .collection("announcements")
    .find({
      $or: [
        { startsAt: { $lte: now }, endsAt: { $gte: now } },
        { startsAt: { $exists: false }, endsAt: { $exists: false } },
      ],
    })
    .limit(3)
    .toArray();
  res.json(items);
});

api.get("/announcements/venue/:venueId", async (req, res) => {
  try {
    const db = getDb();
    const venueId = String(req.params.venueId);
    const query = {
      $or: [{ restaurantId: venueId }, { venueId: venueId }],
      visible: true,
    };
    const ann = await db
      .collection("announcements")
      .findOne(query, { sort: { createdAt: -1 } });
    if (!ann) return res.status(404).json({});
    res.json({
      id: ann._id,
      message: ann.message,
      type: ann.type || "announcement",
      createdAt: ann.createdAt,
    });
  } catch (e) {
    console.error("Error fetching announcement:", e);
    res.status(500).json({ error: "Server error" });
  }
});

api.use("/likes", likesApi);
api.use("/reviews", reviewsApi);
api.use("/history", historyApi);

export default api;
