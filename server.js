// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";

dotenv.config();

const app = express();

// Helpers to handle ES module paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // serve frontend
app.use("/uploads", express.static("uploads")); // serve uploaded images

// MongoDB setup
let owners;

async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("sooner");
    owners = db.collection("owners");
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
  }
}
connectDB();

// ===================== OWNER SIGNUP =====================
app.post("/api/owners/signup", async (req, res) => {
  try {
    const { managerName, businessName, type, phone, email, password } =
      req.body;

    if (!managerName || !businessName || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const existing = await owners.findOne({ email });
    if (existing)
      return res.status(400).json({ error: "Email already exists" });

    const newOwner = {
      managerName,
      businessName,
      type,
      phone,
      email,
      password,
    };
    await owners.insertOne(newOwner);

    res.status(201).json({ message: "Owner registered successfully" });
  } catch (err) {
    console.error("❌ Signup Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================== FILE UPLOAD =====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    res.json({ filePath: `/uploads/${req.file.filename}` });
  } catch (err) {
    console.error("❌ Upload Error:", err);
    res.status(500).json({ error: "File upload failed" });
  }
});

// ===================== DEFAULT ROUTE =====================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ownerSignup.html"));
});

// ===================== SERVER START =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
