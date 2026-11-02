// Shared world, Phase A: claude.ai artifact storage (db), live rooms and user identity.
// LocalBackend is the offline fallback. A Phase B server will implement the same interface.
export interface Peer { id: string; co: string; sponsor: string; p?: number[]; you: boolean }
export interface OpRoom { setPresence(p: any): void; onPeers(cb: (p: Peer[]) => void): void; leave(): void }

export interface WorldBackend {
  kind: string; online: boolean;
  init(): Promise<void>;
  loadSave(): Promise<any>;
  save(s: any): Promise<void>;
  publishCompany(c: any): Promise<void>;
  companies(): Record<string, any>;
  feed(): any[];
  postFeed(co: string, text: string): Promise<void>;
  onChange(fn: () => void): void;
  joinOp(name: string): Promise<OpRoom | null>;
  onlineCount(): number;
}

const KEY = 'perihelion-v4';

export class LocalBackend implements WorldBackend {
  kind = 'local'; online = false; fns: (() => void)[] = [];
  async init() {}
  async loadSave() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
  async save(s: any) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
  async publishCompany() {}
  companies() { return {}; }
  feed() { return []; }
  async postFeed() {}
  onChange(fn: () => void) { this.fns.push(fn); }
  async joinOp() { return null; }
  onlineCount() { return 0; }
}

export class ClaudeBackend implements WorldBackend {
  kind = 'claude'; online = false;
  db: any = null; room: any = null; user: any = null; uid: string | null = null;
  cos: Record<string, any> = {}; fd: any[] = []; peers = 0;
  fns: (() => void)[] = []; local = new LocalBackend(); lastPub = 0;
  emit() { for (const f of this.fns) try { f(); } catch {} }

  async init() {
    const c = (window as any).claude;
    if (!c || !c.use) return;
    const [db, room, user] = await Promise.all([c.use('db'), c.use('room'), c.use('user')]);
    this.db = db; this.room = room; this.user = user;
    if (user) try { this.uid = await user.id(); } catch {}
    if (db) {
      this.online = true;
      db.collection('companies').limit(300).onSnapshot((snap: any) => {
        const out: Record<string, any> = {}, now = Date.now();
        snap.docs.forEach((d: any) => { if (d.exists) { const v = d.data(); if (!v.t || now - v.t < 7 * 864e5) out[d.id] = v; } });
        this.cos = out; this.emit();
      }, () => {});
      db.collection('feed').orderBy('t', 'desc').limit(30).onSnapshot((snap: any) => {
        this.fd = snap.docs.filter((d: any) => d.exists).map((d: any) => d.data()); this.emit();
      }, () => {});
    }
    if (room) room.onPeers((p: any) => { this.peers = (p.peers || []).filter((x: any) => !x.isMe && x.kind === 'viewer').length; this.emit(); }, () => {});
  }
  async loadSave() {
    if (this.db && this.uid) try {
      const d = await this.db.doc('data/users/' + this.uid + '/save4').get();
      if (d.exists) return JSON.parse(d.data().json);
    } catch {}
    return this.local.loadSave();
  }
  async save(s: any) {
    await this.local.save(s);
    if (this.db && this.uid) try { await this.db.doc('data/users/' + this.uid + '/save4').set({ json: JSON.stringify(s), t: Date.now() }); } catch {}
  }
  async publishCompany(c: any) {
    if (!this.db || !this.uid || Date.now() - this.lastPub < 8000) return;
    this.lastPub = Date.now();
    try { await this.db.doc('companies/' + this.uid).set({ ...c, t: Date.now() }); } catch {}
    if (this.room) try { this.room.presence({ co: c.name, sp: c.sponsor }); } catch {}
  }
  companies() { const c = { ...this.cos }; if (this.uid) delete c[this.uid]; return c; }
  feed() { return this.fd; }
  async postFeed(co: string, text: string) { if (this.db) try { await this.db.collection('feed').add({ t: Date.now(), co, text }); } catch {} }
  onChange(fn: () => void) { this.fns.push(fn); }
  async joinOp(name: string): Promise<OpRoom | null> {
    if (!this.room || !this.room.join) return null;
    try {
      const r = await this.room.join(name);
      return {
        setPresence: (p: any) => { try { r.presence(p); } catch {} },
        onPeers: (cb) => r.onPeers((x: any) => cb((x.peers || []).filter((n: any) => n.kind === 'viewer').map((n: any) => ({
          id: n.peer, co: String(n.presence?.co || 'Commander').slice(0, 28), sponsor: String(n.presence?.sp || ''),
          p: Array.isArray(n.presence?.p) ? n.presence.p : undefined, you: !!n.isMe,
        }))), () => {}),
        leave: () => { try { r.leave(); } catch {} },
      };
    } catch { return null; }
  }
  onlineCount() { return this.peers; }
}

export async function createBackend(): Promise<WorldBackend> {
  const c = (window as any).claude;
  const b: WorldBackend = c && c.use ? new ClaudeBackend() : new LocalBackend();
  await b.init();
  return b;
}
