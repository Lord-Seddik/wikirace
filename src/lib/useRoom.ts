import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, RoomView, ServerMessage } from '../../shared/types';
import { ApiError, api } from './api';
import { sfx, syncClock, toast } from './misc';
import { FEATURES } from './features';
import { ensureMe } from './session';

export interface Emote {
  id: number;
  pid: string;
  emoji: string;
}

const FATAL: Record<number, string> = {
  4000: 'This room is open in another tab or window.',
  4001: 'The host removed you from this room.',
  4003: 'This room is full.',
  4004: 'This room does not exist (or it expired).',
};

/** Live connection to a GameRoom: state, emotes, and a send() for room messages. */
export function useRoom(code: string) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [emotes, setEmotes] = useState<Emote[]>([]);
  const ticket = useRef<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const lastChat = useRef(0);
  const reconnectRef = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    ticket.current = null;
    setRoom(null);
    setFatal(null);

    const schedule = () => {
      if (stopped) return;
      const delay = Math.min(8000, 400 * 2 ** retry++);
      if (retry > 3) ticket.current = null;
      reconnectTimer = setTimeout(connect, delay);
    };

    async function connect() {
      if (stopped) return;
      try {
        if (!ticket.current) {
          await ensureMe();
          const r = await api<{ ticket: string }>(`/api/rooms/${code}/ticket`, { method: 'POST' });
          ticket.current = r.ticket;
        }
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
          setFatal(e.message);
          return;
        }
        schedule();
        return;
      }
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws?ticket=${encodeURIComponent(ticket.current!)}`);
      ws.current = sock;
      sock.onopen = () => {
        retry = 0;
        setConnected(true);
        pingTimer = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('ping'), 20_000);
      };
      sock.onmessage = (ev) => {
        if (ev.data === 'pong') return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (msg.t) {
          case 'state': {
            syncClock(msg.room.now);
            const newest = msg.room.chat[msg.room.chat.length - 1];
            if (newest && newest.ts > lastChat.current) {
              if (lastChat.current && newest.kind === 'chat' && newest.pid !== msg.room.you) sfx.chat();
              lastChat.current = newest.ts;
            }
            setRoom(msg.room);
            break;
          }
          case 'emote': {
            const id = Math.random();
            setEmotes((list) => [...list.slice(-20), { id, pid: msg.pid, emoji: msg.emoji }]);
            setTimeout(() => setEmotes((list) => list.filter((e) => e.id !== id)), 2600);
            break;
          }
          case 'toast':
            if (msg.tag === 'achievement' && !FEATURES.achievements) break;
            toast(msg.text, msg.kind ?? 'info');
            break;
          case 'error':
            if (msg.code === 'not_found' || msg.code === 'kicked' || msg.code === 'full') setFatal(msg.message);
            else toast(msg.message, 'bad');
            break;
        }
      };
      sock.onclose = (ev) => {
        clearInterval(pingTimer);
        if (ws.current === sock) ws.current = null;
        setConnected(false);
        if (stopped) return;
        if (FATAL[ev.code]) {
          setFatal((f) => f ?? FATAL[ev.code]);
          return;
        }
        schedule();
      };
    }

    reconnectRef.current = () => {
      const old = ws.current;
      ticket.current = null;
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      if (old) {
        old.onclose = null;
        old.onmessage = null;
        ws.current = null;
        try {
          old.close(1000, 'Refreshing');
        } catch {
          /* already closed */
        }
      }
      retry = 0;
      connect();
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      ws.current?.close(1000, 'Leaving');
      ws.current = null;
    };
  }, [code]);

  const send = useCallback((msg: ClientMessage) => {
    const s = ws.current;
    if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify(msg));
    else toast('Reconnecting to the room…', 'bad');
  }, []);

  /** Reconnect with a fresh pass, e.g. after renaming yourself. */
  const reconnect = useCallback(() => reconnectRef.current(), []);

  return { room, connected, fatal, emotes, send, ticket, reconnect };
}
