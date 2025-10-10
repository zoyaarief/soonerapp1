// server/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { connectToDb, getDb } from "./db.js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Static hosting for /public
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "..", "public")));

// --- Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- Health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- Create Owner (Sign Up)
// Body: { manager, business, type, phone, email, password }
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

    if (!valid) {
      return res.status(400).json({ error: "Invalid payload" });
    }

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
    return res.status(201).json({ ok: true, ownerId: result.insertedId });
  } catch (err) {
    // Duplicate key (email)
    if (err?.code === 11000) {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("Create owner error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// --- Login Owner
// Body: { email, password }
app.post("/api/owners/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email?.trim() || typeof password !== "string") {
      return res.status(400).json({ error: "Missing email/password" });
    }

    const db = getDb();
    const owner = await db.collection("owners").findOne({
      email: email.trim().toLowerCase(),
    });

    if (!owner) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, owner.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // No JWT/session per project constraints—return minimal info
    res.json({ ok: true, business: owner.business });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Fallback to index page if you want (optional)
// app.get("*", (_req, res) => {
//   res.sendFile(path.join(__dirname, "..", "public", "ownerSignUp.html"));
// });

// --- Boot
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
