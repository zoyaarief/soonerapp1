// server/db.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

if (!uri) throw new Error("Missing MONGODB_URI in .env");
if (!dbName) throw new Error("Missing DB_NAME in .env");

const client = new MongoClient(uri, { maxPoolSize: 10 });

let db;

/** Connect once on server start */
export async function connectToDb() {
  if (db) return db;
  await client.connect();
  db = client.db(dbName);

  // Ensure useful indexes (unique email on owners)
  await db.collection("owners").createIndex({ email: 1 }, { unique: true });

  return db;
}

/** Accessor after connect */
export function getDb() {
  if (!db) throw new Error("DB not initialized. Call connectToDb() first.");
  return db;
}

/** Optional graceful shutdown */
export async function closeDb() {
  await client.close();
}
