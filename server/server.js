// server/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import session from "express-session";
import MongoStore from "connect-mongo";
import { connectToDb, getDb } from "./db.js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Static (serves /public)
app.use(express.static(path.join(__dirname, "..", "public")));

// ---- CORS
// If you open pages from http://localhost:5173 (e.g., Vite), keep this:
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
// If you open pages from http://localhost:3000 instead, you can use:
// app.use(cors());

// ---- Body parser
app.use(express.json({ limit: "1mb" }));

// ---- Sessions (Mongo-backed)
app.use(
  session({
    name: "sooner.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      dbName: process.env.DB_NAME,
      collectionName: "sessions",
      ttl: 60 * 60 * 8, // 8 hours
      crypto: { secret: SESSION_SECRET.slice(0, 32) },
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // set true when behind HTTPS in production
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

// ---- Health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---- Auth guard
function requireOwner(req, res, next) {
  if (req.session?.ownerId) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

// ---- Create Owner (Sign Up)
app.post("/api/owners", async (req, res) => {
  try {
    const db = getDb();
    const Owners = db.collection("owners");

    const { manager, business, type, phone, email, password } = req.body || {};
    const valid =
      typeof manager === "string" &&
      typeof business === "string" &&
      typeof type === "string" &&
      typeof phone === "string" &&
      typeof email === "string" &&
      typeof password === "string" &&
      manager.trim() &&
      business.trim() &&
      type.trim() &&
      phone.trim() &&
      email.trim() &&
      password.length >= 8;

    if (!valid) return res.status(400).json({ error: "Invalid payload" });

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = {
      manager: manager.trim(),
      business: business.trim(),
      type: type.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await Owners.insertOne(doc);

    // Ensure the session is fully written *before* responding
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.ownerId = String(result.insertedId);
      req.session.business = doc.business;
      req.session.save((err2) => {
        if (err2) return res.status(500).json({ error: "Session save error" });
        return res
          .status(201)
          .json({
            ok: true,
            ownerId: result.insertedId,
            business: doc.business,
          });
      });
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("Create owner error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ---- Login Owner
app.post("/api/owners/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email?.trim() || typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Missing email/password" });
    }

    const db = getDb();
    const owner = await db.collection("owners").findOne({
      email: email.trim().toLowerCase(),
    });
    if (!owner) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, owner.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.ownerId = String(owner._id);
      req.session.business = owner.business;
      req.session.save((err2) => {
        if (err2) return res.status(500).json({ error: "Session save error" });
        res.json({ ok: true, business: owner.business });
      });
    });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ---- Session status
app.get("/api/session", (req, res) => {
  if (req.session?.ownerId) {
    return res.json({
      ok: true,
      ownerId: req.session.ownerId,
      business: req.session.business,
    });
  }
  return res.status(401).json({ ok: false, error: "Not authenticated" });
});

// ---- Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sooner.sid");
    res.json({ ok: true });
  });
});

// ---- Boot
connectToDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("DB connection failed:", e);
    process.exit(1);
  });
