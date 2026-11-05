# Workspace Memory - LabWebAv-WebSocketChat

## Project Overview
WebSocket chat application using Socket.IO, Node.js, Express, HTML5, CSS3, JavaScript Vanilla.
Academic project for Aplicaciones Web course.

## Architecture
- **Server**: `server/server.js` — Express HTTP server + Socket.IO + Firebase Admin + JWT
- **Client**: `public/` — HTML/CSS/JS separated (no inline styles or scripts)
- **Auth Flow**: Firebase Auth (client) → Firebase ID Token → POST /api/auth/verify → JWT (server-signed) → Socket.IO auth
- **Database**: Firestore (messages persisted in collection "messages")
- **Config**: All secrets/vars loaded from `.env` via dotenv

## Key Decisions
- Replaced raw `ws` library with Socket.IO for richer event system, auto-reconnect, and fallback support
- Firebase Auth for user authentication (email/password); firebase-admin verifies tokens server-side
- JWT (jsonwebtoken) signed with JWT_SECRET from .env; Socket.IO middleware verifies JWT on every connection
- Firestore persists all chat messages; /api/messages endpoint returns last 50 (JWT-protected)
- CORS restricted to ALLOWED_ORIGINS from .env (both Express and Socket.IO)
- Server validates and escapes HTML for all messages (never trusts client data)
- Username obtained from JWT (not client-supplied) — server is source of truth for identity
- Theme (light/dark) persisted in LocalStorage; auto-detects system preference on first visit
- Typing indicator uses debounce (1500ms) to avoid event flooding
- Message bubbles: received=left (gray), sent=right (green) — WhatsApp style
- Graceful fallback: if Firebase not configured, server runs in "demo mode" (JWT still active)
- .env and firebase-service-account.json in .gitignore

## Dependencies
- express, socket.io, dotenv, jsonwebtoken, firebase-admin, cors

## Commands
- `npm install` — install all deps
- `npm start` — runs `node server/server.js` on port 3000
- Configure `.env` with Firebase credentials to enable Auth + Firestore
