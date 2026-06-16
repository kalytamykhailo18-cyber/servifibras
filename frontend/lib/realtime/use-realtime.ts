"use client";

import { useEffect } from "react";
import { connectRealtime, disconnectRealtime } from "./socket";
import { useAuthStore, selectUser } from "@/lib/store/auth-store";

// Subscribe to a server event for the lifetime of the calling component.
// Returns nothing — the handler runs whenever the event arrives.
export function useRealtimeEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void,
) {
  const user = useAuthStore(selectUser);

  useEffect(() => {
    if (!user) return;
    const sock = connectRealtime();
    if (!sock) return;
    const wrap = (payload: T) => handler(payload);
    sock.on(event, wrap as any);
    return () => {
      sock.off(event, wrap as any);
    };
  }, [user, event, handler]);
}

// Connect once per session. Mount this hook inside the dashboard layout so
// the socket comes up as soon as the user is authenticated and tears down on
// logout.
export function useRealtimeConnection() {
  const user = useAuthStore(selectUser);

  useEffect(() => {
    if (!user) {
      disconnectRealtime();
      return;
    }
    connectRealtime();
    return () => {
      // Don't disconnect on every dependency change — only on logout, which
      // sets `user` to null and triggers the branch above on the next run.
    };
  }, [user]);
}
