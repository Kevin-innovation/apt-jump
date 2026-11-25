export const UPDATE_INTERVAL = 30_000;

export interface UpdateOptions {
  current: string;
  fetch: typeof fetch;
  storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  onUpdate: (version: string) => void;
}

/** Failed/offline checks are harmless. Comparing with the bundle ID detects upgrades since this tab opened. */
export class ReleaseWatcher {
  private checking = false;
  private notified = false;
  constructor(private options: UpdateOptions) {}
  async check(): Promise<void> {
    if (this.checking || this.notified) return;
    this.checking = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.options.fetch(new URL('./version.json', location.href), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return;
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(data.id)) return;
      if (data.id === this.options.current) return;
      const guard = `${this.options.current}:${data.id}`;
      // If a stale CDN serves the old bundle after reload, do not reload forever.
      try {
        if (this.options.storage().getItem('apt-jump.reloaded') === guard) return;
        this.options.storage().setItem('apt-jump.reloaded', guard);
      } catch { /* URL guard still protects a tab without storage */ }
      if (new URL(location.href).searchParams.get('updated') === data.id) return;
      this.notified = true;
      this.options.onUpdate(data.id);
    } catch { /* offline, timed out, invalid response */ }
    finally { clearTimeout(timer); this.checking = false; }
  }
}

export function watchReleases(current: string, onUpdate: (version: string) => void): void {
  const watcher = new ReleaseWatcher({ current, fetch: window.fetch.bind(window), storage: () => sessionStorage, onUpdate });
  const check = () => { if (!document.hidden) void watcher.check(); };
  setInterval(check, UPDATE_INTERVAL);
  addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  check();
}
