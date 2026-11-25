import type { Account } from './online/types';

const KEY = 'apt-jump.welcome.v1';
/** A first-visit invitation, never an account requirement. Works without writable storage. */
export class FirstVisit {
  private seen = false;
  constructor(private storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => localStorage) {
    try { this.seen = this.storage().getItem(KEY) === '1'; } catch { /* memory only */ }
  }
  dismiss(): void {
    this.seen = true;
    try { this.storage().setItem(KEY, '1'); } catch { /* memory only */ }
  }
  shouldShow(status: Account['status']): boolean {
    if (status === 'in') this.dismiss();
    return status === 'out' && !this.seen;
  }
}
