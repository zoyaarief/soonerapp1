# Sooner - Virtual Walk‑In Queue Manager

Sooner is a Node.js + Express + Vanilla JS web app that lets **walk‑in customers** join a **virtual queue** for venues (restaurants, salons, clinics, events), and lets **venue owners** manage walk‑ins efficiently. Customers browse venues, view real‑time queue stats, enter/cancel the queue, get a 45‑minute *near‑turn* timer, and post reviews after they’re served.

> **Status:** actively developed. This repo contains both the backend (Node/Express/MongoDB) and a vanilla‑JS frontend (no frameworks).

---

## ✨ Features (Customer‑facing - handled by Piriyajeishree Murali Naidu)

- Browse venues with **search & filters** (type, city, cuisine, rating).
- **Place page** with live stats: number in queue, approx wait, your position, seats left, status (“Open/Closed”), gallery, announcements, features, hours.
- **Join queue** with robust rules (venue open, walk‑ins enabled, queue active, capacity available, max party size).
- **Cancel queue** (idempotent) and **“I’m here”** to pause the near‑turn timer.
- **45‑minute timer** that **starts at position ≤ 5**, persists across reloads, and pauses on arrival.
- **User dashboard** shows **Active Queue** and **Venues for Today** (favorites + recents; hides sections when empty).
- **Ratings & reviews** (only after “served”); shows latest reviews per venue.
- **Announcements**: venue broadcasts (offers/notices) displayed on the place page.
- **Favorites**: like/unlike venues from cards.

## ✨ Features (Owner‑facing – handled by Nandana Pradeep)

- Owner signup/login, profile, gallery management.
- Owner settings: `openStatus`, `walkinsEnabled`, `queueActive`, `totalSeats`, `avgWaitMins`, `maxBooking`.
- Queue operations: serve, cancel, mark no‑shows, post announcements.
- Dashboard to watch live queue & control parameters.

---

## 🗂️ Tech Stack

- **Backend:** Node.js, Express, MongoDB (Atlas).
- **Frontend:** Vanilla JavaScript (ES Modules), HTML, CSS (modular files per page).
- **Auth:** Session‑based (cookie), customer and owner roles.
- **Build/Style:** Prettier (format), ESLint (lint).
- **License:** MIT.

---

## 📁 Project Structure (key parts)

```
server/
  server.js
  api.routes.js
  db.js
  api.owner.js
  api.owner.sse.js
  api.likes.js
  api.reviews.js
  api.history.js
  queueWorker.js

public/
  index.html
  browse.html
  place.html
  userDashboard.html
  ownerSignUp.html
  ownerDashboard.html
  ownerProfile.html
  userProfile.html

  js/
    browse.js
    place.js
    userDashboard.js
    ownerDashboard.js
    ownerProfile.js

  css/
    browse.css
    place.css
    userDashboard.css
    ownerDashboard.css
    ownerProfile.css
    ownerSignUp.css
    userProfile.css
    flashscreen.css
```

---

## Key API Endpoints (Customer‑relevant)

- `GET /api/owners/public`
- `GET /api/owners/public/:id`
- `GET /api/queue/metrics/:venueId`
- `POST /api/queue/:venueId/join` *(or `POST /api/queue/join`)*
- `POST /api/queue/:venueId/cancel` *(or `POST /api/queue/cancel`)*
- `POST /api/queue/:venueId/arrived` *(or `POST /api/queue/arrived`)*
- `GET /api/reviews/venue/:venueId`, `POST /api/reviews/add`

> Collections in use: `owners`, `owner_settings`, `queue`, `customers`, `activitylog`, `announcements`, `likes`, `reviews`, `sessions` (and optionally `venues` for legacy/demo).

---

## Queue Rules (Customer join)

- Venue must be **open**, **walk‑ins enabled**, **queue active**.
- **Capacity**: `owner_settings.totalSeats` must have enough spots left (sum of active `partySize`).
- **Max party size**: `owners.profile.maxBooking` (default 12).
- **No duplicates**: same customer cannot have another **active** entry (same venue or any venue).
- Inserted queue doc fields (validator‑friendly): `venueId`, `customerId`, `name`, `email`, `partySize`, `status:"active"`, `joinedAt` (+ bridges: `people`, `order`, `position`).

---

## ⏱️ 45‑Minute Near‑Turn Timer

- Starts automatically the first time **position ≤ 5**.
- Persisted in `localStorage` per venue; survives polling/reloads.
- “I’m here” pauses the countdown; auto‑hides on cancel/leave/served.
- Optional auto‑cancel on expiry (disabled by default).

---

## 🔐 Environment

Create `.env` in project root:

```
PORT=3000
MONGODB_URI=<your Atlas connection string>
SESSION_SECRET=<random strong secret>
NODE_ENV=development
```

> **Never commit secrets.** Use environment variables in deployment.

---

## ▶️ Run Locally
**Prereqs**

1. Install Node.js 18+ (LTS recommended).
2. Have a MongoDB Atlas connection string. (we have provided in the .env section below)
3. Clone & enter
```bash
git clone <repo-url> soonerapp1
cd soonerapp1
```
4. Env file
Create a .env in the project root:
```bash
PORT=3000
MONGODB_URI=<your Atlas connection string>
SESSION_SECRET=change-me
NODE_ENV=development
```
5. Install deps
```bash
npm install
```
6. Start server
```bash
npm start
```
7. Open the app
Visit: http://localhost:3000

8. Lint/format
```bash
npm run lint
npm run format
```
9. (Optional) Seed quick data
Create an owner via Owner Sign Up in the UI, or insert small sample docs into owners (strictly avoid large base64 images; otherwise, it will significantly slow down our app).
---

## Rubric Mapping

- **Project description:** See top.
- **Personas & Stories:** See `DESIGN.md`.
- **Mockups:** See `DESIGN.md`.
- **Usable/Useful:** Virtual queue reduces physical waiting.
- **ESLint/Prettier:** Sample configs below.
- **Organization & Modules:** Server/client split; per‑page CSS/JS; `db.js` connector.
- **Vanilla JS CSR:** place.js, browse.js, userDashboard.js.
- **Forms:** Owner signup/profile; Reviews form; Join queue input.
- **Deployed:** Add URL when ready.
- **Mongo CRUD:** owners, owner_settings, queue, reviews, likes.
- **Node + Express:** Yes.
- **No secrets in repo:** Use `.env`.
- **MIT License:** Included.
- **package.json** present.

### Lint/Format configs

`.eslintrc.json`:
```json
{
  "env": { "es2022": true, "node": true, "browser": true },
  "extends": ["eslint:recommended"],
  "parserOptions": { "ecmaVersion": "latest", "sourceType": "module" },
  "rules": {
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "no-undef": "error",
    "no-console": "off"
  },
  "ignorePatterns": ["public/js/vendor/**","**/*.min.js"]
}
```

`.prettierrc`:
```json
{ "semi": true, "singleQuote": false, "printWidth": 100, "trailingComma": "es5" }
```

---

## 📜 License

MIT — see `LICENSE`.
