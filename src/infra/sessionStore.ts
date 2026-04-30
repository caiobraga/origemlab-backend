export type SessionData = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  email?: string | null;
};

export type SessionStore = {
  get(sessionId: string): SessionData | null;
  set(sessionId: string, data: SessionData): void;
  delete(sessionId: string): void;
};

export function createInMemorySessionStore(): SessionStore {
  const map = new Map<string, SessionData>();
  return {
    get(id) {
      return map.get(id) ?? null;
    },
    set(id, data) {
      map.set(id, data);
    },
    delete(id) {
      map.delete(id);
    },
  };
}

