import { defaultStickySelfSessionState } from 'self-engine';
import { SessionMemory } from './types';

export class SessionStore {
  private readonly sessions = new Map<string, SessionMemory>();

  get(sessionId: string): SessionMemory {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const created: SessionMemory = {
      stickyState: defaultStickySelfSessionState(),
      history: [],
      flags: {
        circleSuggested: false,
      },
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  reset(sessionId: string, keepStickyState: boolean): void {
    const existing = this.get(sessionId);
    const stickyState = keepStickyState ? existing.stickyState : defaultStickySelfSessionState();

    this.sessions.set(sessionId, {
      stickyState,
      history: [],
      flags: {
        circleSuggested: false,
      },
    });
  }

  clearAll(): void {
    this.sessions.clear();
  }
}
