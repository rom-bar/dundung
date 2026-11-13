import timing from '../../data/stage-animations.json';
import type { StageVisualEvent } from '../../core/types';

export type AnimationSpeed = '1x' | '2x' | 'skip';

export interface StageEventFrame {
  event: StageVisualEvent | null;
  progress: number;
  summary: boolean;
}

const durations = timing.durationsMs as Record<StageVisualEvent['type'], number>;
const defaultDurationMs = Number.isFinite(timing.defaultDurationMs) && timing.defaultDurationMs > 0
  ? timing.defaultDurationMs
  : 420;
const battleEventTypes = new Set<StageVisualEvent['type']>([
  'enemy_appear', 'boss_intro', 'combat_start', 'attack', 'miss', 'heal', 'buff_applied', 'status_applied', 'victory', 'boss_phase', 'faint',
]);

export function stageEventCaption(event: StageVisualEvent | null): string | null {
  if (!event) return null;
  switch (event.type) {
    case 'walk_start': return `Pip heads along the path · Floor ${event.floor}`;
    case 'room_enter': return `${event.roomType[0]!.toUpperCase()}${event.roomType.slice(1)} room ahead`;
    case 'enemy_appear': return `${event.name} appears`;
    case 'boss_intro': return `${event.enemyName} · a boss enters the path`;
    case 'combat_start': return `Pip faces ${event.enemyName}`;
    case 'attack': return `${event.actor} uses ${event.skill} · ${event.amount} damage${event.critical ? ' · critical' : ''}`;
    case 'miss': return `${event.actor} misses a turn`;
    case 'heal': return `Pip restores ${event.amount} health`;
    case 'buff_applied': return `${event.target === 'pet' ? 'Pip' : 'The enemy'} gains ${event.stat ?? 'a buff'} · ${event.turns} turns`;
    case 'status_applied': return `${event.target === 'pet' ? 'Pip' : 'The enemy'} gains ${event.status}${event.stat ? ` · ${event.stat}` : ''}`;
    case 'item_used': return `${event.name} used`;
    case 'chest_open': return `Chest opened · ${event.coins} coins${event.tokenFound ? ' · token found' : ''}`;
    case 'loot_drop': return `${event.name ?? 'A find'} discovered`;
    case 'room_story': return event.title;
    case 'victory': return `${event.enemyName} defeated`;
    case 'boss_phase': return `${event.enemyName} reveals a new move`;
    case 'floor_cleared': return `Floor ${event.floor} cleared`;
    case 'run_complete': return `Safe return · Floor ${event.floor}`;
    case 'faint': return `Pip needs a rest · Floor ${event.floor}`;
    case 'return_home': return 'Back to Pip’s habitat';
  }
}

export class StageEventPlayer {
  private pending: StageVisualEvent[] = [];
  private active: StageVisualEvent | null = null;
  private elapsedMs = 0;
  private activeDurationMs = 0;
  private summaryEvent: StageVisualEvent | null = null;
  private summaryRemainingMs = 0;
  private lastEventId = 0;
  private history: StageVisualEvent[] = [];

  enqueue(events: StageVisualEvent[]): void {
    for (const event of events) {
      if (event.id <= this.lastEventId) continue;
      this.lastEventId = event.id;
      this.pending.push(event);
      this.history.push(event);
      if (this.history.length > timing.maximumHistory) this.history.splice(0, this.history.length - timing.maximumHistory);
    }
  }

  advance(deltaMs: number, speed: AnimationSpeed, reducedMotion: boolean, decisionPaused = false): void {
    if (decisionPaused) return;
    const safeDelta = Number.isFinite(deltaMs) ? Math.max(0, Math.min(deltaMs, 1_000)) : 0;
    if (speed === 'skip') {
      this.summaryRemainingMs = Math.max(0, this.summaryRemainingMs - safeDelta);
      if (this.summaryRemainingMs === 0) this.summaryEvent = null;
      const last = this.pending.at(-1) ?? this.active;
      this.pending = [];
      this.active = null;
      this.elapsedMs = 0;
      this.activeDurationMs = 0;
      if (last) {
        this.summaryEvent = last;
        this.summaryRemainingMs = timing.skipSummaryMs;
      }
      return;
    }

    this.summaryRemainingMs = Math.max(0, this.summaryRemainingMs - safeDelta);
    if (this.summaryRemainingMs === 0) this.summaryEvent = null;
    let remaining = safeDelta * (speed === '2x' ? 2 : 1);
    while (remaining > 0) {
      if (!this.active) {
        this.active = this.pending.shift() ?? null;
        this.elapsedMs = 0;
        const configuredDuration = this.active ? durations[this.active.type] : 0;
        this.activeDurationMs = this.active
          ? reducedMotion
            ? timing.reducedMotionMs
            : Number.isFinite(configuredDuration) && configuredDuration > 0 ? configuredDuration : defaultDurationMs
          : 0;
        if (!this.active) break;
      }
      const step = Math.min(remaining, Math.max(0, this.activeDurationMs - this.elapsedMs));
      this.elapsedMs += step;
      remaining -= step;
      if (this.elapsedMs >= this.activeDurationMs) {
        this.summaryEvent = this.active;
        this.summaryRemainingMs = reducedMotion ? timing.reducedMotionMs : Math.min(220, this.activeDurationMs);
        this.active = null;
        this.elapsedMs = 0;
        this.activeDurationMs = 0;
      }
      if (step === 0 && this.active) break;
    }
  }

  frame(): StageEventFrame {
    if (this.active) {
      return { event: this.active, progress: Math.max(0, Math.min(1, this.elapsedMs / Math.max(1, this.activeDurationMs))), summary: false };
    }
    if (this.summaryEvent && this.summaryRemainingMs > 0) return { event: this.summaryEvent, progress: 1, summary: true };
    return { event: null, progress: 0, summary: false };
  }

  eventLog(): StageVisualEvent[] {
    return this.history.map((event) => ({ ...event }));
  }

  queueLength(): number {
    return this.pending.length + Number(Boolean(this.active));
  }

  hasBattleSequence(): boolean {
    const events = [...this.pending, ...(this.active ? [this.active] : []), ...(this.summaryEvent ? [this.summaryEvent] : [])];
    return events.some((event) => battleEventTypes.has(event.type)
      || (event.type === 'room_enter' && ['fight', 'elite', 'boss'].includes(event.roomType)));
  }

  reset(): void {
    this.pending = [];
    this.active = null;
    this.elapsedMs = 0;
    this.activeDurationMs = 0;
    this.summaryEvent = null;
    this.summaryRemainingMs = 0;
    this.lastEventId = 0;
    this.history = [];
  }
}
