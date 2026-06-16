"use client";

// Real-time notifications client. Connects once per browser session,
// authenticates with the auth store's JWT, and exposes a tiny pub/sub for
// React hooks to subscribe to specific server events.
//
// Connection target reads from process.env.NEXT_PUBLIC_API_BASE_URL — the same
// value the REST client uses. There is no fallback URL inside the source; if
// the env var is missing we deliberately log and skip connection so the bug
// surfaces fast instead of silently pointing at localhost in production.

import { io, Socket } from "socket.io-client";
import { tokenManager } from "@/lib/api/client";

let socket: Socket | null = null;
let connecting = false;

function url(): string | null {
  const u = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!u) {
    // eslint-disable-next-line no-console
    console.warn("[realtime] NEXT_PUBLIC_API_BASE_URL not set — real-time notifications disabled");
    return null;
  }
  return u;
}

export function connectRealtime(): Socket | null {
  if (typeof window === "undefined") return null;
  if (socket && socket.connected) return socket;
  if (connecting) return socket;

  const target = url();
  if (!target) return null;

  const token = tokenManager.get();
  if (!token) return null;

  connecting = true;
  socket = io(target, {
    transports: ["websocket"],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on("connect", () => {
    connecting = false;
  });
  socket.on("connect_error", () => {
    connecting = false;
  });
  socket.on("auth:error", () => {
    // Token rotated or expired — drop the socket; the next connect attempt
    // will pick up a fresh token from the auth store.
    socket?.disconnect();
    socket = null;
    connecting = false;
  });
  socket.on("disconnect", () => {
    connecting = false;
  });

  return socket;
}

export function disconnectRealtime(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getRealtime(): Socket | null {
  return socket;
}
