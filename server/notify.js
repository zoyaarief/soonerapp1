// server/notify.js
import nodemailer from "nodemailer";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();

/**
 * Returns a best-effort venue name for messages.
 */
export function venueDisplayName(venueDoc) {
  if (!venueDoc) return "Sooner Venue";
  return (
    venueDoc?.profile?.displayName ||
    venueDoc?.business ||
    "Sooner Venue"
  );
}

/**
 * Send an email using Gmail (App Password recommended).
 * If GMAIL_USER or GMAIL_APP_PASS are missing, this becomes a no-op.
 */
async function sendEmail(to, subject, text) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASS || !to) return false;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"Sooner Queue" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
  });
  return true;
}

/**
 * Send an SMS using Twilio.
 * If TWILIO_* env vars are missing, this becomes a no-op.
 */
async function sendSMS(to, body) {
  if (!process.env.TWILIO_SID || !process.env.TWILIO_TOKEN || !process.env.TWILIO_PHONE || !to) {
    return false;
  }
  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_PHONE,
    to,
    body,
  });
  return true;
}

/**
 * Unified notifier: prefer email if present; otherwise SMS if present.
 * Never throws — logs and returns false on failure.
 */
export async function notifyUserOnJoin({ email, phone, name, venueName }) {
  const person = name?.trim() || "there";
  const vname = venueName?.trim() || "Sooner Venue";
  const message =
    `Hey ${person}! You’ve joined the queue at ${vname}. ` +
    `You can check your live position anytime. We’ll ping you again when your turn is near.`;

  try {
    // Prefer email if we have it
    if (email && (await sendEmail(email, `You're in the queue at ${vname}!`, message))) {
      console.log(`Joined notification sent to ${email}`);
      return true;
    }
    if (phone && (await sendSMS(phone, message))) {
      console.log(`Joined notification sent to ${phone}`);
      return true;
    }
    console.log("No contact info to notify (email/phone missing).");
    return false;
  } catch (err) {
    console.error("notifyUserOnJoin failed:", err?.message || err);
    return false;
  }
}
