// server/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import session from "express-session";
import MongoStore from "connect-mongo";
import { connectToDb, getDb, getClient } from "./db.js";
import path from "path";
import { fileURLToPath } from "url";
import "./queueWorker.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- CORS
// If you open pages from http://localhost:5173, keep this:
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
// If you open pages from http://localhost:3000 instead, you can use:
// app.use(cors());

// ---- JSON body (allow base64 images)
app.use(express.json({ limit: "50mb" }));

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
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);
// --- Debug session store connection ---
const store = app.get("sessionStore");
if (store) console.log("Session store ready ✅");
else console.log("⚠️  No session store found!");

// ---- Modular API Routes ----
import api from "./api.routes.js";          // existing shared routes (yours)
import ownerApi from "./api.owner.js";      // new owner logic routes
import ownerSSE from "./api.owner.sse.js";  // new SSE live queue stream

app.use("/api", api);
app.use("/api", ownerApi);
app.use("/api", ownerSSE);

// ---- Static (serves /public)
app.use(express.static(path.join(__dirname, "..", "public")));

// ---- Health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/debug/session", (req, res) => {
  res.json({
    id: req.sessionID,
    ownerId: req.session?.ownerId || null,
    keys: Object.keys(req.session || {}),
  });
});

// ---- Boot
connectToDb()
  .then(() => {
    const db = getDb();

    // helpful indices
    db.collection("owners")
      .createIndex({ email: 1 }, { unique: true })
      .catch(() => {});

    // primary queue collection (index by venueId/restaurantId + position)
    db.collection("queue")
      .createIndex({ venueId: 1, position: 1 })
      .catch(() => {});
    db.collection("queue")
      .createIndex({ restaurantId: 1, position: 1 })
      .catch(() => {});

    // TTL for pending deletes
    db.collection("queue_pending")
      .createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 })
      .catch(() => {});

    db.collection("announcements")
      .createIndex({ ownerId: 1, createdAt: -1 })
      .catch(() => {});
    db.collection("announcements")
      .createIndex({ ownerIdObj: 1, createdAt: -1 })
      .catch(() => {});

    // settings (owner_settings used by dashboard; "settings" kept for public gate compatibility)
    db.collection("owner_settings")
      .createIndex({ ownerId: 1 }, { unique: true })
      .catch(() => {});
    db.collection("settings")
      .createIndex({ ownerId: 1 }, { unique: true })
      .catch(() => {});

    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("DB connection failed:", e);
    process.exit(1);
  });
  