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

  // Useful index: unique email for owners
  await db.collection("owners").createIndex({ email: 1 }, { unique: true });
  await db.collection("venues").createIndex({ category: 1, rating: -1 });
  await db.collection("venues").createIndex({ "location": "2dsphere" }); // if you store coords
  await db.collection("likes").createIndex({ userId: 1, venueId: 1 }, { unique: true });
  await db.collection("queue").createIndex({ venueId: 1, status: 1, order: 1 });
  await db.collection("queue").createIndex({ userId: 1, status: 1 });
  await db.collection("queue").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  return db;
}

/** Accessor after connect */
export function getDb() {
  if (!db) throw new Error("DB not initialized. Call connectToDb() first.");
  return db;
}

/** Expose the client (needed for transactions) */
export function getClient() {
  return client;
}

/** Optional graceful shutdown */
export async function closeDb() {
  await client.close();
}
