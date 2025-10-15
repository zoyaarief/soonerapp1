// server/api.routes.js
import express from "express";
import { getDb } from "./db.js";
import { ObjectId, Int32 } from "mongodb";
import bcrypt from "bcrypt";
import likesApi from "./api.likes.js";
import reviewsApi from "./api.reviews.js";
import historyApi from "./api.history.js";
import { notifyUserOnJoin, venueDisplayName } from "./notify.js";

function venueMatch(raw) {
  const s = String(raw);
  const ors = [{ venueId: s }, { restaurantId: s }];
  if (ObjectId.isValid(s)) {
    const oid = new ObjectId(s);
    ors.push({ venueId: oid }, { restaurantId: oid });
  }
  return { $or: ors };
}

// Small helpers to keep code cleaner
function idVariantsForQuery(rawId) {
  const s = String(rawId);
  const maybeOID = ObjectId.isValid(s) ? new ObjectId(s) : null;
  // We may have stored either customerId or userId, as string or ObjectId
  return [
    { customerId: s },
    maybeOID && { customerId: maybeOID },
    { userId: s },
    maybeOID && { userId: maybeOID },
  ].filter(Boolean);
}

function asObjectId(v, { required = false, name = "id" } = {}) {
  if (v == null || v === "") {
    if (required) throw new Error(`${name} is required`);
    return undefined;
  }
  const s = String(v);
  if (!ObjectId.isValid(s)) {
    if (required) throw new Error(`${name} must be a valid ObjectId`);
    return undefined;
  }
  return new ObjectId(s);
}
function asDate(v, { fallbackNow = false, name = "date" } = {}) {
  if (v == null || v === "") return fallbackNow ? new Date() : undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()))
    throw new Error(`${name} must be a valid date`);
  return d;
}
function asInt32(v, { min = 1, name = "number" } = {}) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`${name} must be an integer ≥ ${min}`);
  }
  return new Int32(n);
}
function oneOf(v, allowed, { name = "value", optional = false } = {}) {
  if (v == null || v === "") return optional ? undefined : undefined;
  if (!allowed.includes(v)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return v;
}

function asId(x) {
  if (!x) return null;
  return ObjectId.isValid(x) ? new ObjectId(x) : x; // supports already-ObjectId
}
function http400(res, msg) {
  return res.status(400).json({ error: msg || "Bad request" });
}
function http401(res) {
  return res.status(401).json({ error: "Not authenticated" });
}

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

api.post("/customers/update", async (req, res) => {
  if (!req.session?.customerId)
    return res.status(401).json({ error: "Not authenticated" });
  const db = getDb();
  const { name, phone } = req.body;
  await db
    .collection("customers")
    .updateOne(
      { _id: new ObjectId(req.session.customerId) },
      { $set: { name, phone } }
    );
  res.json({ ok: true });
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

  const activeCount = await db
    .collection("queue")
    .countDocuments({ venueId: venueId, status: "active" });
  res.json({ ...venue, activeCount });
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
// ===================== END OWNERS PUBLIC ENDPOINTS =====================

// --- Active queue for the logged-in customer ---
// api.get("/queue/active", async (req, res) => {
//   try {
//     const db = getDb();
//     const customerId = req.session?.customerId;
//     if (!customerId) return res.status(204).end(); // no user -> treat as no queue

//     // Find the most recent "waiting" queue entry
//     const q = await db.collection("queue").findOne(
//       {
//         customerId: String(customerId),
//         status: { $in: ["waiting", "joined"] },
//       },
//       { sort: { joinedAt: -1 } }
//     );
//     if (!q) return res.status(204).end();

//     // Compute position within that venue's active queue
//     const venueId = String(q.venueId);
//     const all = await db
//       .collection("queue")
//       .find({ venueId, status: { $in: ["waiting", "joined"] } })
//       .sort({ joinedAt: 1 })
//       .toArray();

//     const index = all.findIndex((x) => String(x._id) === String(q._id));
//     const position = index >= 0 ? index + 1 : null;

//     // Approx wait: 8 min per party by default; prefer owner_settings.avgWaitMins if set.
//     const settings = await db.collection("owner_settings").findOne({ venueId });
//     const avgPerParty = Number(settings?.avgWaitMins) || 8;
//     const approxWaitMins = position ? position * avgPerParty : null;

//     // Venue display name
//     const venue = await db
//       .collection("owners")
//       .findOne(
//         { _id: ObjectId.isValid(venueId) ? new ObjectId(venueId) : venueId },
//         { projection: { business: 1, "profile.displayName": 1 } }
//       );

//     res.json({
//       venueId,
//       venueName: venue?.profile?.displayName || venue?.business || "—",
//       position,
//       people: Number(q.people || 1),
//       approxWaitMins,
//     });
//   } catch (err) {
//     console.error("GET /queue/active error:", err);
//     res.status(204).end(); // hide section on any failure
//   }
// });
// api.get("/queue/active", async (req, res) => {
//   try {
//     const db = getDb();
//     const customerId = req.session?.customerId;
//     if (!customerId) return res.status(204).end();

//     // most recent live (waiting or active)
//     const q = await db.collection("queue").findOne(
//       {
//         customerId: String(customerId),
//         status: { $in: ["waiting", "active"] },
//       },
//       { sort: { joinedAt: -1 } }
//     );
//     if (!q) return res.status(204).end();

//     const venueId = String(q.venueId);

//     // live entries sorted by FCFS order
//     const all = await db
//       .collection("queue")
//       .find({ venueId, status: { $in: ["waiting", "active"] } })
//       .sort({ order: 1, joinedAt: 1, _id: 1 })
//       .toArray();

//     const index = all.findIndex((x) => String(x._id) === String(q._id));
//     const position = index >= 0 ? index + 1 : null;

//     // settings (support ownerId/venueId, OID/string)
//     const vOID = ObjectId.isValid(venueId) ? new ObjectId(venueId) : null;
//     const settings = await db.collection("owner_settings").findOne({
//       $or: [
//         { venueId },
//         vOID && { venueId: vOID },
//         { ownerId: venueId },
//         vOID && { ownerId: vOID },
//       ].filter(Boolean),
//     });

//     const avgPerParty = Number(settings?.avgWaitMins) || 8;
//     const approxWaitMins = position ? position * avgPerParty : null;

//     // venue display name
//     const venue = await db
//       .collection("owners")
//       .findOne(
//         { _id: vOID || venueId },
//         { projection: { business: 1, "profile.displayName": 1 } }
//       );

//     res.json({
//       venueId,
//       venueName: venue?.profile?.displayName || venue?.business || "—",
//       position,
//       people: Number(q.people || q.partySize || 1),
//       approxWaitMins,
//     });
//   } catch (err) {
//     console.error("GET /queue/active error:", err);
//     res.status(204).end();
//   }
// });

api.get("/queue/active", async (req, res) => {
  try {
    const db = getDb();
    const customerId = req.session?.customerId;
    if (!customerId) return res.status(204).end();

    // find most recent live entry for me (waiting/active), matching either id flavor
    const q = await db.collection("queue").findOne(
      {
        status: { $in: ["waiting", "active"] },
        $or: idVariantsForQuery(customerId),
      },
      { sort: { joinedAt: -1 } }
    );
    if (!q) return res.status(204).end();

    const venueId = String(q.venueId);

    // derive live position by FCFS order
    const all = await db
      .collection("queue")
      .find({ venueId, status: { $in: ["waiting", "active"] } })
      .sort({ order: 1, joinedAt: 1, _id: 1 })
      .toArray();

    const index = all.findIndex((x) => String(x._id) === String(q._id));
    const position = index >= 0 ? index + 1 : null;

    const vOID = ObjectId.isValid(venueId) ? new ObjectId(venueId) : null;
    const settings = await db.collection("owner_settings").findOne({
      $or: [
        { venueId },
        { venueId: venueId },
        vOID && { venueId: vOID },
        { ownerId: venueId },
        vOID && { ownerId: vOID },
      ].filter(Boolean),
    });

    const avgPerParty = Number(settings?.avgWaitMins) || 8;
    const approxWaitMins = position ? position * avgPerParty : null;

    const venue = await db
      .collection("owners")
      .findOne(
        { _id: vOID || venueId },
        { projection: { business: 1, "profile.displayName": 1 } }
      );

    res.json({
      venueId,
      venueName: venue?.profile?.displayName || venue?.business || "—",
      position,
      people: Number(q.people || q.partySize || 1),
      approxWaitMins,
    });
  } catch (err) {
    console.error("GET /queue/active error:", err);
    res.status(204).end();
  }
});

// Public venue metrics (for place page)
// api.get("/queue/metrics/:venueId", async (req, res) => {
//   try {
//     const db = getDb();
//     const raw = req.params.venueId;
//     const venueId = ObjectId.isValid(raw) ? new ObjectId(raw) : raw;

//     // owner settings (open/closed, walk-ins, seats, avg wait)
//     const settings = await db.collection("owner_settings").findOne({ venueId });

//     // active queue (validator enum: "active","served","cancelled","no_show")
//     const active = await db
//       .collection("queue")
//       .find({ venueId, status: "active" })
//       .sort({ joinedAt: 1 })
//       .toArray();

//     const count = active.length;
//     const totalPeople = active.reduce(
//       (sum, q) => sum + Number(q.partySize || q.people || 1),
//       0
//     );

//     const avgPerParty = Number(settings?.avgWaitMins) || 8; // minutes per party
//     const approxWaitMins = count ? count * avgPerParty : 0;

//     const totalSeats = Number(settings?.totalSeats || 0);
//     const seatsUsed = Math.min(totalPeople, totalSeats || totalPeople);
//     const spotsLeft = totalSeats ? Math.max(0, totalSeats - totalPeople) : null;

//     // try to compute position for the current customer (or allow override for testing)
//     const customerId = req.query.customerId || req.session?.customerId;
//     let position = null;
//     if (customerId) {
//       const idx = active.findIndex(
//         (x) => String(x.customerId) === String(customerId)
//       );
//       position = idx >= 0 ? idx + 1 : null;
//     }

//     res.json({
//       // openStatus: settings?.openStatus || "closed",
//       walkinsEnabled: !!settings?.walkinsEnabled,
//       // queueActive: settings?.queueActive !== false,
//       count,
//       totalPeople,
//       approxWaitMins,
//       position,
//       capacity: {
//         totalSeats,
//         seatsUsed,
//         spotsLeft,
//       },
//     });
//   } catch (err) {
//     console.error("GET /api/queue/metrics/:venueId error:", err);
//     res.status(500).json({ error: "Server error" });
//   }
// });
api.get("/queue/metrics/:venueId", async (req, res) => {
  try {
    const db = getDb();
    const raw = req.params.venueId;
    const venueId = ObjectId.isValid(raw) ? new ObjectId(raw) : raw;

    // owner settings (support string/OID and ownerId/venueId)
    const vStr =
      venueId instanceof ObjectId ? venueId.toHexString() : String(venueId);
    const vOID = ObjectId.isValid(vStr) ? new ObjectId(vStr) : null;
    const settings = await db.collection("owner_settings").findOne({
      $or: [
        { venueId },
        { venueId: vStr },
        vOID && { venueId: vOID },
        { ownerId: vStr },
        vOID && { ownerId: vOID },
      ].filter(Boolean),
    });

    // live queue
    const active = await db
      .collection("queue")
      .find({ venueId, status: { $in: ["waiting", "active"] } })
      .sort({ order: 1, joinedAt: 1, _id: 1 })
      .toArray();

    const count = active.length;
    const totalPeople = active.reduce(
      (sum, q) => sum + Number(q.partySize || q.people || 1),
      0
    );

    const avgPerParty = Number(settings?.avgWaitMins) || 8;
    const approxWaitMins = count ? count * avgPerParty : 0;

    const totalSeats = Number(settings?.totalSeats || 0);
    const seatsUsed = Math.min(totalPeople, totalSeats || totalPeople);
    const spotsLeft = totalSeats ? Math.max(0, totalSeats - totalPeople) : null;

    // try to compute position for this customer if available
    const customerId = req.query.customerId || req.session?.customerId;
    let position = null;
    if (customerId) {
      const idx = active.findIndex(
        (x) => String(x.customerId) === String(customerId)
      );
      position = idx >= 0 ? idx + 1 : null;
    }

    res.json({
      walkinsEnabled: !!settings?.walkinsEnabled,
      count,
      totalPeople,
      approxWaitMins,
      position,
      capacity: {
        totalSeats,
        seatsUsed,
        spotsLeft,
      },
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

    const rows = await db
      .collection("likes")
      .find({ customerId: customerId, liked: { $ne: false } })
      .project({ venueId: 1, _id: 0 })
      .toArray();

    // normalize venueId to string
    const out = rows.map((r) => ({
      venueId:
        r.venueId && r.venueId._bsontype === "ObjectID"
          ? String(r.venueId)
          : String(r.venueId),
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

    const agg = await db
      .collection("activitylog")
      .aggregate([
        {
          $match: {
            customerId: customerId,
            createdAt: { $gte: since },
            action: { $in: ["served", "visited", "joined"] },
          },
        },
        { $group: { _id: "$venueId", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 12 },
      ])
      .toArray();

    const out = agg.map((a) => ({
      venueId:
        a._id && a._id._bsontype === "ObjectID" ? String(a._id) : String(a._id),
      count: a.count,
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
      // openStatus: s.openStatus === "open" ? "open" : "closed",
      // queueActive: s.queueActive !== false,
    });
  } catch (err) {
    console.error("Error fetching owner settings:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- Queue ----------
// --- Active queue for the logged-in customer (or ?customerId= for testing) ---

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

//POST /api/queue/:venueId/join  (path param)
api.post("/queue/:venueId/join", async (req, res) => {
  req.body = { ...(req.body || {}), venueId: req.params.venueId };
  return enqueue(req, res);
});

//Minimal join endpoint — drop-in simple version
// api.post("/queue/:venueId/join", async (req, res) => {
//   try {
//     const db = getDb();

//     // 1) Require a logged-in customer
//     const customerId = req.session?.customerId;
//     if (!customerId)
//       return res.status(401).json({ error: "Not authenticated" });

//     // 2) Determine id types based on queue validator (ObjectId vs string)
//     const validator = await getQueueValidator(db);
//     const preferObjectId = wantsObjectId(validator);

//     const venueParam = String(req.params.venueId || "").trim();
//     if (!venueParam)
//       return res.status(400).json({ error: "venueId is required" });

//     const venueId =
//       preferObjectId && ObjectId.isValid(venueParam)
//         ? new ObjectId(venueParam)
//         : venueParam;

//     const restaurantId = venueId; // keep in sync with seeder

//     // 3) Pull optional user display info (name/email/phone)
//     let userId = customerId;
//     if (preferObjectId && ObjectId.isValid(customerId)) {
//       userId = new ObjectId(customerId);
//     }
//     const cust = await db.collection("customers").findOne(
//       {
//         _id: ObjectId.isValid(customerId)
//           ? new ObjectId(customerId)
//           : customerId,
//       },
//       { projection: { name: 1, email: 1, phone: 1 } }
//     );

//     const name = (req.body?.name ?? cust?.name ?? "Customer").toString();
//     const email = (req.body?.email ?? cust?.email ?? "").toString();
//     const phone = (req.body?.phone ?? cust?.phone ?? "").toString();

//     // 4) party size (store BOTH people and partySize)
//     const people = Number(req.body?.people ?? req.body?.partySize ?? 1);
//     if (!Number.isFinite(people) || people < 1)
//       return res.status(400).json({ error: "Invalid party size" });

//     // 5) Compute order/position among "waiting" for this venue
//     const now = new Date();
//     const order =
//       (await db
//         .collection("queue")
//         .countDocuments({ venueId, status: "waiting" })) + 1;

//     // 6) Build schema-compliant doc (mirror your seeder)
//     const doc = {
//       venueId,
//       restaurantId,

//       userId, // note: schema uses userId (ObjectId preferred)
//       name,
//       email,
//       phone,

//       people,
//       partySize: people,

//       status: "waiting",
//       order,
//       position: order,

//       joinedAt: now,
//       createdAt: now,

//       // optional timing fields used by your seeder/worker
//       nearTurnAt: null,
//       arrivalDeadline: null,
//       timerPaused: false,
//     };

//     // 7) Insert
//     const { insertedId } = await db.collection("queue").insertOne(doc);

//     // 8) Respond (position is order at insert time)
//     return res.json({
//       ok: true,
//       id: String(insertedId),
//       position: order,
//       status: "waiting",
//     });
//   } catch (err) {
//     console.error("JOIN (schema-aligned) error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// });

// api.post("/queue/hardcoded", async (req, res) => {
//   try {
//     const db = getDb();

//     // destructure body (everything optional except required-by-schema)
//     const {
//       venueId,
//       userId,
//       name,
//       email,
//       phone,
//       partySize,
//       serviceUnitId,
//       queueMode, // 'fifo' | 'timeSlots'
//       joinedAt,
//       appointmentAt,
//       estimatedReadyAt,
//       nearTurnAt,
//       arrivalDeadline,
//       timerPaused,
//       status, // 'active' | 'served' | 'cancelled' | 'no_show'
//       notes,
//     } = req.body || {};

//     // --- Coerce & validate to match your $jsonSchema ---
//     const doc = {
//       // REQUIRED
//       venueId: asObjectId(venueId, { required: true, name: "venueId" }),
//       name: String(name || "").trim(),
//       email: String(email || "").trim(),
//       partySize: asInt32(partySize, { min: 1, name: "partySize" }),
//       status:
//         oneOf(status, ["active", "served", "cancelled", "no_show"], {
//           name: "status",
//         }) || "active",
//       joinedAt: asDate(joinedAt, { fallbackNow: true, name: "joinedAt" }),

//       // OPTIONALS
//       userId: asObjectId(userId, { required: false, name: "userId" }),
//       phone: phone != null ? String(phone) : undefined,
//       serviceUnitId: asObjectId(serviceUnitId, {
//         required: false,
//         name: "serviceUnitId",
//       }),
//       queueMode: oneOf(queueMode, ["fifo", "timeSlots"], {
//         name: "queueMode",
//         optional: true,
//       }),
//       appointmentAt: asDate(appointmentAt, { name: "appointmentAt" }),
//       estimatedReadyAt: asDate(estimatedReadyAt, { name: "estimatedReadyAt" }),
//       nearTurnAt: asDate(nearTurnAt, { name: "nearTurnAt" }),
//       arrivalDeadline: asDate(arrivalDeadline, { name: "arrivalDeadline" }),
//       timerPaused:
//         typeof timerPaused === "boolean"
//           ? timerPaused
//           : timerPaused == null
//             ? undefined
//             : Boolean(timerPaused),
//       notes: typeof notes === "string" ? notes : undefined,
//     };

//     // Required string fields must be non-empty
//     if (!doc.name) throw new Error("name is required");
//     if (!doc.email) throw new Error("email is required");

//     // strip undefined so validator doesn't see them
//     Object.keys(doc).forEach((k) => doc[k] === undefined && delete doc[k]);

//     const result = await db.collection("queue").insertOne(doc);
//     return res.status(201).json({ ok: true, insertedId: result.insertedId });
//   } catch (err) {
//     // return a clean 400 for bad inputs; 500 for others
//     const msg = String(err?.message || err);
//     const isInput = /required|must be|invalid|ObjectId|date|integer|≥/i.test(
//       msg
//     );
//     if (isInput) return res.status(400).json({ error: msg });
//     console.error("Insert queue (body) failed:", err);
//     return res.status(500).json({ error: "Insert failed" });
//   }
// });

// POST /api/queue/join  (expects { venueId, partySize? or people? })
// api.post("/queue/join", async (req, res) => {
//   return enqueue(req, res);
// });

// ---- Implementation ----
// async function enqueue(req, res) {
//   try {
//     const db = getDb();

//     const {
//       venueId,
//       userId,
//       name,
//       email,
//       phone,
//       partySize,
//       serviceUnitId,
//       queueMode, // 'fifo' | 'timeSlots'
//       joinedAt,
//       appointmentAt,
//       estimatedReadyAt,
//       nearTurnAt,
//       arrivalDeadline,
//       timerPaused,
//       status, // 'active' | 'served' | 'cancelled' | 'no_show'
//       notes,
//     } = req.body || {};

//     // 1) Auth — require logged-in customer
//     // const customerId = req.session?.userId;
//     // if (!customerId) return http401(res);

//     // 2) Resolve inputs
//     // const rawVenueId = req.body?.venueId;
//     // if (!rawVenueId) return http400(res, "venueId is required");

//     // const venueId = asId(rawVenueId);
//     // const partySize = Number(req.body?.partySize ?? req.body?.people ?? 1);
//     // if (!Number.isFinite(partySize) || partySize < 1) {
//     //   return http400(res, "Invalid party size");
//     // }

//     // 3) Load customer (validator requires name/email)
//     // const customer = await db
//     //   .collection("customers")
//     //   .findOne(
//     //     { _id: asId(customerId) },
//     //     { projection: { name: 1, email: 1 } }
//     //   );
//     // if (!customer) return http401(res);

//     // const name = (req.body?.name || customer.name || "Customer").toString();
//     // const email = (req.body?.email || customer.email || "").toString();

//     // 4) Venue settings + optional limits
//     // const settings = await db.collection("owner_settings").findOne({ venueId });
//     // const openOk = settings?.openStatus === "open";
//     //const walkOk = !!settings?.walkinsEnabled;
//     // const queueOk = settings?.queueActive !== false;

//     // if (!walkOk) {
//     //   return http400(res, "Queue not accepting walk-ins now");
//     // }

//     // const rawVenueId0 = req.body?.venueId;
//     // if (!rawVenueId0) return http400(res, "venueId is required");
//     // const venueIdStr = String(rawVenueId0);
//     // const venueIdObj = ObjectId.isValid(venueIdStr)
//     //   ? new ObjectId(venueIdStr)
//     //   : null;

//     // Try multiple keys because your data may be stored under ownerId or venueId, string or ObjectId
//     // const settings = await db.collection("owner_settings").findOne({
//     //   $or: [
//     //     venueIdObj && { venueId: venueIdObj },
//     //     { venueId: venueIdStr },
//     //     venueIdObj && { ownerId: venueIdObj },
//     //     { ownerId: venueIdStr },
//     //   ].filter(Boolean),
//     // });

//     // Helpful logs (remove in prod)
//     // if (!settings) {
//     //   console.warn("[enqueue] owner_settings not found for", {
//     //     venueIdStr,
//     //     tried: [
//     //       "venueId(ObjectId)",
//     //       "venueId(string)",
//     //       "ownerId(ObjectId)",
//     //       "ownerId(string)",
//     //     ],
//     //   });
//     // }

//     // Decide policy if settings missing: allow or block?
//     // DEV-FRIENDLY: allow when missing, or require explicit flag — your choice.
//     // const walkOk = settings ? !!settings.walkinsEnabled : true; // <-- allow when missing (dev)
//     // if (!walkOk) {
//     //   return http400(res, "Walk-ins are disabled for this venue right now");
//     // }

//     // // Optional per-venue max booking limit (fallback 12)
//     // // From owners.profile.maxBooking if you store it there; else default
//     // const owner = await db
//     //   .collection("owners")
//     //   .findOne({ _id: venueId }, { projection: { "profile.maxBooking": 1 } });
//     // const maxBooking = Number(owner?.profile?.maxBooking ?? 12);
//     // if (partySize > maxBooking) {
//     //   return http400(res, `Party size exceeds max allowed (${maxBooking})`);
//     // }

//     // 5) Capacity check (seats)
//     // const totalSeats = Number(settings?.totalSeats ?? 0); // 0 => unlimited
//     // if (totalSeats > 0) {
//     //   const agg = await db
//     //     .collection("queue")
//     //     .aggregate([
//     //       { $match: { venueId, status: "active" } },
//     //       {
//     //         $group: {
//     //           _id: null,
//     //           seats: {
//     //             $sum: {
//     //               $ifNull: ["$partySize", { $ifNull: ["$people", 1] }],
//     //             },
//     //           },
//     //         },
//     //       },
//     //     ])
//     //     .toArray();

//     //   const used = agg[0]?.seats ?? 0;
//     //   const spotsLeft = Math.max(0, totalSeats - used);

//     //   if (partySize > spotsLeft) {
//     //     return http400(res, "Not enough spots left for your party size");
//     //   }
//     // }

//     // 6) Prevent duplicate active entries
//     // (a) same venue
//     // const alreadyHere = await db.collection("queue").findOne({
//     //   venueId,
//     //   customerId: customerId,
//     //   status: "active",
//     // });
//     // if (alreadyHere) {
//     //   const allActive = await db
//     //     .collection("queue")
//     //     .find({ venueId, status: "active" })
//     //     .sort({ joinedAt: 1 })
//     //     .project({ _id: 1 })
//     //     .toArray();
//     //   const pos = allActive.findIndex(
//     //     (x) => String(x._id) === String(alreadyHere._id)
//     //   );
//     //   return res.json({
//     //     ok: true,
//     //     order: String(alreadyHere._id),
//     //     position: pos >= 0 ? pos + 1 : null,
//     //     approxWaitMins: computeApproxWait(settings, pos >= 0 ? pos + 1 : 0),
//     //   });
//     // }

//     // (b) optionally prevent being active in any other venue
//     // const otherVenueActive = await db.collection("queue").findOne({
//     //   customerId: customerId,
//     //   status: "active",
//     // });
//     // if (otherVenueActive) {
//     //   return http400(res, "You are already in another active queue");
//     // }

//     // 7) Insert queue doc (conform to your validator schema)
//     const doc = {
//       venueId,
//       userId: customerId,
//       name,
//       email,
//       partySize,
//       status: "active", // validator enum: active|served|cancelled|no_show
//       joinedAt: new Date(),
//     };
//     const ins = await db.collection("queue").insertOne(doc);

//     // 8) Activity log (optional but useful)
//     // await db.collection("activitylog").insertOne({
//     //   customerId: customerId,
//     //   venueId,
//     //   action: "joined",
//     //   createdAt: new Date(),
//     // });

// 9) Compute position + ETA after insert
// const after = await db
//   .collection("queue")
//   .find({ venueId, status: "active" })
//   .sort({ joinedAt: 1 })
//   .project({ _id: 1 })
//   .toArray();
// const idx = after.findIndex(
//   (x) => String(x._id) === String(ins.insertedId)
// );
// const position = idx >= 0 ? idx + 1 : null;

//     return res.json({
//       ok: true,
//       // order: String(ins.insertedId),
//       // position,
//       // approxWaitMins: computeApproxWait(settings, position || 0),
//     });
//   } catch (err) {
//     console.error("JOIN error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// }

// async function enqueue(req, res) {
//   try {
//     const db = getDb();
//     const b = req.body || {};

//     // Accept ObjectId or string; don't force OID
//     const venueId = ObjectId.isValid(b.venueId)
//       ? new ObjectId(b.venueId)
//       : String(b.venueId || "").trim();
//     if (!venueId) return res.status(400).json({ error: "venueId is required" });

//     const existing = await db.collection("queue").findOne({
//       venueId,
//       $or: [
//         { userId: b.userId },
//         { customerId: b.userId }, // handle both cases
//       ],
//       status: "active",
//     });
//     if (existing) {
//       return res.status(200).json({ ok: true, message: "Already in queue" });
//     }

//     const userId = ObjectId.isValid(b.userId)
//       ? new ObjectId(b.userId)
//       : b.userId
//         ? String(b.userId)
//         : undefined;

//     const partySize = new Int32(
//       Math.max(1, Number(b.partySize ?? b.people ?? 1))
//     );

//     const doc = {
//       venueId,
//       userId, //optional
//       customerId: userId,
//       name: String(b.name || ""),
//       email: String(b.email || ""),
//       phone: b.phone ? String(b.phone) : undefined,
//       partySize,
//       serviceUnitId: ObjectId.isValid(b.serviceUnitId)
//         ? new ObjectId(b.serviceUnitId)
//         : b.serviceUnitId
//           ? String(b.serviceUnitId)
//           : undefined,
//       queueMode: ["fifo", "timeSlots"].includes(b.queueMode)
//         ? b.queueMode
//         : undefined,
//       joinedAt: b.joinedAt ? new Date(b.joinedAt) : new Date(),
//       appointmentAt: b.appointmentAt ? new Date(b.appointmentAt) : undefined,
//       estimatedReadyAt: b.estimatedReadyAt
//         ? new Date(b.estimatedReadyAt)
//         : undefined,
//       nearTurnAt: b.nearTurnAt ? new Date(b.nearTurnAt) : undefined,
//       arrivalDeadline: b.arrivalDeadline
//         ? new Date(b.arrivalDeadline)
//         : undefined,
//       timerPaused:
//         typeof b.timerPaused === "boolean" ? b.timerPaused : undefined,
//       status: ["active", "served", "cancelled", "no_show"].includes(b.status)
//         ? b.status
//         : "active",
//       notes: b.notes ? String(b.notes) : undefined,
//     };

//     // strip undefined
//     Object.keys(doc).forEach((k) => doc[k] === undefined && delete doc[k]);

//     const ins = await db.collection("queue").insertOne(doc);

//     const after = await db
//       .collection("queue")
//       .find({ venueId, status: "active" })
//       .sort({ joinedAt: 1 })
//       .project({ _id: 1 })
//       .toArray();
//     const idx = after.findIndex(
//       (x) => String(x._id) === String(ins.insertedId)
//     );
//     const position = idx > 0 ? idx + 1 : null;

//     return res.json({
//       ok: true,
//       order: String(ins.insertedId),
//       position,
//       approxWaitMins: computeApproxWait(settings, position || 0),
//     });
//   } catch (err) {
//     if (err?.code === 121) {
//       return res
//         .status(400)
//         .json({ error: "Document failed validation", details: err?.errInfo });
//     }
//     console.error("JOIN error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// }
async function enqueue(req, res) {
  try {
    const db = getDb();
    const b = req.body || {};

    // venueId may be string or ObjectId
    const venueId = ObjectId.isValid(b.venueId)
      ? new ObjectId(b.venueId)
      : String(b.venueId || "").trim();

    if (!venueId) return res.status(400).json({ error: "venueId is required" });

    // prevent duplicate live entry for same user at this venue
    const existing = await db.collection("queue").findOne({
      venueId,
      $or: [{ userId: b.userId }, { customerId: b.userId }],
      status: { $in: ["waiting", "active"] },
    });
    if (existing) {
      return res.status(200).json({ ok: true, message: "Already in queue" });
    }

    // normalize userId and party size
    const userId = ObjectId.isValid(b.userId)
      ? new ObjectId(b.userId)
      : b.userId
        ? String(b.userId)
        : undefined;

    const partySize = new Int32(
      Math.max(1, Number(b.partySize ?? b.people ?? 1))
    );

    // stable FCFS order counter
    const order = await nextOrder(db, String(venueId));

    // resolve settings for ETA (supports ownerId/venueId, string/OID)
    const vStr =
      venueId instanceof ObjectId ? venueId.toHexString() : String(venueId);
    const vOID = ObjectId.isValid(vStr) ? new ObjectId(vStr) : null;
    const settings = await db.collection("owner_settings").findOne({
      $or: [
        { venueId },
        { venueId: vStr },
        vOID && { venueId: vOID },
        { ownerId: vStr },
        vOID && { ownerId: vOID },
      ].filter(Boolean),
    });

    // build doc (store both order and initial position)
    const doc = {
      venueId,
      userId,
      customerId: userId,
      name: String(b.name || ""),
      email: String(b.email || ""),
      phone: b.phone ? String(b.phone) : undefined,
      partySize,
      serviceUnitId: ObjectId.isValid(b.serviceUnitId)
        ? new ObjectId(b.serviceUnitId)
        : b.serviceUnitId
          ? String(b.serviceUnitId)
          : undefined,
      queueMode: ["fifo", "timeSlots"].includes(b.queueMode)
        ? b.queueMode
        : undefined,
      joinedAt: b.joinedAt ? new Date(b.joinedAt) : new Date(),
      appointmentAt: b.appointmentAt ? new Date(b.appointmentAt) : undefined,
      estimatedReadyAt: b.estimatedReadyAt
        ? new Date(b.estimatedReadyAt)
        : undefined,
      nearTurnAt: b.nearTurnAt ? new Date(b.nearTurnAt) : undefined,
      arrivalDeadline: b.arrivalDeadline
        ? new Date(b.arrivalDeadline)
        : undefined,
      timerPaused:
        typeof b.timerPaused === "boolean" ? b.timerPaused : undefined,
      status: ["active", "served", "cancelled", "no_show"].includes(b.status)
        ? b.status
        : "active",
      notes: b.notes ? String(b.notes) : undefined,
      order: new Int32(order),
      position: new Int32(order),
    };

    Object.keys(doc).forEach((k) => doc[k] === undefined && delete doc[k]);

    const ins = await db.collection("queue").insertOne(doc);

    // compute live position by FCFS order
    const after = await db
      .collection("queue")
      .find({ venueId, status: { $in: ["waiting", "active"] } })
      .sort({ order: 1, joinedAt: 1, _id: 1 })
      .project({ _id: 1 })
      .toArray();

    const idx = after.findIndex(
      (x) => String(x._id) === String(ins.insertedId)
    );
    const position = idx >= 0 ? idx + 1 : null;

    // Resolve a human venue name then notify
    let venueName = "Sooner Venue";
    try {
      const vQuery = ObjectId.isValid(String(venueId))
        ? { _id: new ObjectId(String(venueId)) }
        : { _id: String(venueId) };
      const venue = await db
        .collection("owners")
        .findOne(vQuery, { projection: { business: 1, "profile.displayName": 1 } });
      venueName = venueDisplayName(venue);
    } catch {}

    await notifyUserOnJoin({
      email: doc.email,
      phone: doc.phone,
      name: doc.name,
      venueName,
    });

    return res.json({
      ok: true,
      id: String(ins.insertedId),
      position,
      approxWaitMins: computeApproxWait(settings, position || 0),
    });
  } catch (err) {
    if (err?.code === 121) {
      return res
        .status(400)
        .json({ error: "Document failed validation", details: err?.errInfo });
    }
    console.error("JOIN error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

function computeApproxWait(settings, position) {
  const avgPerParty = Number(settings?.avgWaitMins) || 8;
  return position ? position * avgPerParty : 0;
}

// POST /api/queue/:venueId/cancel
api.post("/queue/:venueId/cancel", async (req, res) => {
  req.body = { ...(req.body || {}), venueId: req.params.venueId };
  return cancelEnqueue(req, res);
});

// POST /api/queue/cancel   (expects { venueId })
api.post("/queue/cancel", async (req, res) => {
  return cancelEnqueue(req, res);
});

// async function cancelEnqueue(req, res) {
//   try {
//     const db = getDb();
//     const customerId = req.session?.customerId;
//     if (!customerId) return http401(res);

//     const venueId = asId(req.body?.venueId);
//     if (!venueId) return http400(res, "venueId is required");

//     const q = await db.collection("queue").findOne({
//       venueId,
//       customerId: customerId,
//       status: "active",
//     });

//     if (!q) {
//       // Idempotent: nothing to cancel, just succeed
//       return res.json({ ok: true });
//     }

//     await db
//       .collection("queue")
//       .updateOne(
//         { _id: q._id },
//         { $set: { status: "cancelled", cancelledAt: new Date() } }
//       );

//     await db.collection("activitylog").insertOne({
//       customerId: customerId,
//       venueId,
//       action: "cancelled",
//       createdAt: new Date(),
//     });

//     return res.json({ ok: true });
//   } catch (err) {
//     console.error("CANCEL error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// }

// POST /api/queue/:venueId/arrived
// async function cancelEnqueue(req, res) {
//   try {
//     const db = getDb();
//     const customerId = req.session?.customerId;
//     if (!customerId) return http401(res);

//     const venueId = asId(req.body?.venueId);
//     if (!venueId) return http400(res, "venueId is required");

//     const q = await db.collection("queue").findOne({
//       venueId,
//       customerId: customerId,
//       status: { $in: ["waiting", "active"] },
//     });

//     if (!q) {
//       // idempotent
//       return res.json({ ok: true });
//     }

//     await db
//       .collection("queue")
//       .updateOne(
//         { _id: q._id },
//         { $set: { status: "cancelled", cancelledAt: new Date() } }
//       );

//     await db.collection("activitylog").insertOne({
//       customerId: customerId,
//       venueId,
//       action: "cancelled",
//       createdAt: new Date(),
//     });

//     return res.json({ ok: true });
//   } catch (err) {
//     console.error("CANCEL error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// }

// async function cancelEnqueue(req, res) {
//   try {
//     const db = getDb();
//     const customerId = req.session?.customerId;
//     if (!customerId) return http401(res);

//     const venueId = asId(req.body?.venueId);
//     if (!venueId) return http400(res, "venueId is required");

//     const q = await db.collection("queue").findOne({
//       venueId,
//       status: { $in: ["waiting", "active"] },
//       $or: idVariantsForQuery(customerId),
//     });

//     if (!q) {
//       // Idempotent: nothing to cancel is still success
//       return res.json({ ok: true, already: true });
//     }

//     await db
//       .collection("queue")
//       .updateOne(
//         { _id: q._id },
//         { $set: { status: "cancelled", cancelledAt: new Date() } }
//       );

//     await db.collection("activitylog").insertOne({
//       customerId: String(customerId),
//       venueId,
//       action: "cancelled",
//       createdAt: new Date(),
//     });

//     return res.json({ ok: true });
//   } catch (err) {
//     console.error("CANCEL error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// }
// async function cancelEnqueue(req, res) {
//   try {
//     const db = getDb();
//     const customerId = req.session?.customerId;
//     if (!customerId) return http401(res);

//     const rawVenueId = req.body?.venueId;
//     if (!rawVenueId) return http400(res, "venueId is required");

//     const vStr = String(rawVenueId);
//     const vOID = ObjectId.isValid(vStr) ? new ObjectId(vStr) : null;

//     // Match *either* string or ObjectId forms of venueId
//     const venueFilter = {
//       $or: [{ venueId: rawVenueId }, { venueId: vStr }].concat(
//         vOID ? [{ venueId: vOID }] : []
//       ),
//     };

//     const q = await db.collection("queue").findOne({
//       ...venueFilter,
//       status: { $in: ["waiting", "active"] },
//       $or: idVariantsForQuery(customerId),
//     });

//     if (!q) {
//       // Idempotent success if nothing to cancel
//       return res.json({ ok: true, already: true });
//     }

//     await db
//       .collection("queue")
//       .updateOne(
//         { _id: q._id },
//         { $set: { status: "cancelled", cancelledAt: new Date() } }
//       );

//     // Best-effort logging (don’t convert success into 500)
//     try {
//       await db.collection("activitylog").insertOne({
//         type: "queue.cancelled",
//         action: "cancelled",
//         customerId: String(customerId),
//         venueIdStr: vStr,
//         venueId: vOID ?? undefined,
//         createdAt: new Date(),
//       });
//     } catch (logErr) {
//       console.warn("activitylog insert skipped:", logErr?.message || logErr);
//     }

//     return res.json({ ok: true });
//   } catch (err) {
//     console.error("CANCEL error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// }
async function cancelEnqueue(req, res) {
  try {
    const db = getDb();
    const customerId = req.session?.customerId;
    if (!customerId) return http401(res);

    const rawVenueId = req.body?.venueId;
    if (!rawVenueId) return http400(res, "venueId is required");

    // Find the live entry for this user at this venue (supports string/ObjectId + venueId/restaurantId)
    const q = await db.collection("queue").findOne({
      ...venueMatch(rawVenueId),
      status: { $in: ["waiting", "active"] },
      $or: idVariantsForQuery(customerId),
    });

    if (!q) return res.json({ ok: true, already: true });

    // HARD DELETE
    await db.collection("queue").deleteOne({ _id: q._id });

    // (Optional) reindex live positions so any stored `position` stays tidy
    try {
      const key = q.venueId ?? q.restaurantId ?? rawVenueId;
      const live = await db
        .collection("queue")
        .find({
          $or: [{ venueId: key }, { restaurantId: key }],
          status: { $in: ["waiting", "active"] },
        })
        .sort({ order: 1, joinedAt: 1, _id: 1 })
        .project({ _id: 1 })
        .toArray();
      if (live.length) {
        const ops = live.map((d, i) => ({
          updateOne: {
            filter: { _id: d._id },
            update: { $set: { position: i + 1, updatedAt: new Date() } },
          },
        }));
        await db.collection("queue").bulkWrite(ops, { ordered: false });
      }
    } catch (e) {
      console.warn("reindex skipped:", e?.message || e);
    }

    // Best-effort activity log (never fail the request)
    try {
      await db.collection("activitylog").insertOne({
        type: "queue.cancelled",
        action: "cancelled",
        customerId: String(customerId),
        venueIdStr: String(rawVenueId),
        venueId: ObjectId.isValid(String(rawVenueId))
          ? new ObjectId(String(rawVenueId))
          : undefined,
        createdAt: new Date(),
      });
    } catch (logErr) {
      console.warn("activitylog insert skipped:", logErr?.message || logErr);
    }

    return res.json({ ok: true, deleted: String(q._id) });
  } catch (err) {
    console.error("CANCEL error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

api.post("/queue/:venueId/arrived", async (req, res) => {
  req.body = { ...(req.body || {}), venueId: req.params.venueId };
  return arrivedMark(req, res);
});

// POST /api/queue/arrived  (expects { venueId })
api.post("/queue/arrived", async (req, res) => {
  return arrivedMark(req, res);
});

// async function arrivedMark(req, res) {
//   try {
//     const db = getDb();
//     const customerId = req.session?.customerId;
//     if (!customerId) return http401(res);

//     const venueId = asId(req.body?.venueId);
//     if (!venueId) return http400(res, "venueId is required");

//     const upd = await db
//       .collection("queue")
//       .updateOne(
//         { venueId, customerId: customerId, status: "active" },
//         { $set: { arrivedAt: new Date(), arrived: true } }
//       );

//     if (!upd.matchedCount) return res.json({ ok: true }); // nothing to mark; idempotent
//     await db.collection("activitylog").insertOne({
//       customerId: customerId,
//       venueId,
//       action: "arrived",
//       createdAt: new Date(),
//     });
//     return res.json({ ok: true });
//   } catch (err) {
//     console.error("ARRIVED error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// }

// async function arrivedMark(req, res) {
//   try {
//     const db = getDb();
//     const customerId = req.session?.customerId;
//     if (!customerId) return http401(res);

//     const venueId = asId(req.body?.venueId);
//     if (!venueId) return http400(res, "venueId is required");

//     const upd = await db.collection("queue").updateOne(
//       {
//         venueId,
//         customerId: customerId,
//         status: { $in: ["waiting", "active"] },
//       },
//       { $set: { arrivedAt: new Date(), arrived: true } }
//     );

//     if (!upd.matchedCount) return res.json({ ok: true }); // idempotent
//     await db.collection("activitylog").insertOne({
//       customerId: customerId,
//       venueId,
//       action: "arrived",
//       createdAt: new Date(),
//     });
//     return res.json({ ok: true });
//   } catch (err) {
//     console.error("ARRIVED error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// }

async function arrivedMark(req, res) {
  try {
    const db = getDb();
    const customerId = req.session?.customerId;
    if (!customerId) return http401(res);

    const venueId = asId(req.body?.venueId);
    if (!venueId) return http400(res, "venueId is required");

    const upd = await db.collection("queue").updateOne(
      {
        venueId,
        status: { $in: ["waiting", "active"] },
        $or: idVariantsForQuery(customerId),
      },
      { $set: { arrivedAt: new Date(), arrived: true } }
    );

    if (!upd.matchedCount) return res.json({ ok: true }); // idempotent

    await db.collection("activitylog").insertOne({
      customerId: String(customerId),
      venueId,
      action: "arrived",
      createdAt: new Date(),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("ARRIVED error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

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

// Latest reviews for a venue (public)
api.get("/reviews/venue/:venueId", async (req, res) => {
  try {
    const db = getDb();
    const raw = req.params.venueId;
    const venueId = ObjectId.isValid(raw) ? new ObjectId(raw) : raw;

    // compute average + count
    const stats = await db
      .collection("reviews")
      .aggregate([
        { $match: { venueId } },
        { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
      ])
      .toArray();

    const avgRating = stats[0]?.avg ?? null;
    const total = stats[0]?.count ?? 0;

    // pull latest N reviews
    const reviews = await db
      .collection("reviews")
      .find({ venueId })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    // (optional) resolve customer names from customers collection
    const customersMap = new Map();
    for (const r of reviews) {
      const cid =
        r.customerId && r.customerId._bsontype === "ObjectID"
          ? r.customerId
          : ObjectId.isValid(r.customerId)
            ? new ObjectId(r.customerId)
            : null;
      if (cid && !customersMap.has(String(cid))) {
        const cust = await db
          .collection("customers")
          .findOne({ _id: cid }, { projection: { name: 1, email: 1 } });
        customersMap.set(String(cid), cust?.name || "");
      }
    }

    res.json({
      avgRating,
      total,
      items: reviews.map((r) => ({
        _id: String(r._id),
        rating: r.rating,
        comment: r.comment || "",
        customerName: customersMap.get(String(r.customerId)) || "",
        createdAt: r.createdAt,
      })),
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
