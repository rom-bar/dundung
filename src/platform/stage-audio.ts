import type { StageEventFrame } from '../render/stage/event-player';
import type { StageVisualEvent } from '../core/types';

type Tone = readonly [number, number, number, number, OscillatorType];
const cues = {
  hit: [[150, 48, 0.09, 0, 'triangle'], [840, 190, 0.045, 0.005, 'square']],
  crit: [[95, 36, 0.14, 0, 'triangle'], [1300, 320, 0.07, 0.01, 'square'], [680, 980, 0.1, 0.04, 'sine']],
  heal: [[460, 740, 0.12, 0, 'sine'], [740, 1080, 0.17, 0.065, 'triangle']],
  pickup: [[740, 920, 0.08, 0, 'triangle'], [1100, 1480, 0.14, 0.05, 'sine']],
  step: [[95, 60, 0.045, 0, 'triangle'], [110, 70, 0.04, 0.17, 'triangle']],
  eat: [[290, 180, 0.055, 0, 'square'], [340, 210, 0.05, 0.12, 'square'], [580, 740, 0.11, 0.24, 'sine']],
  ui: [[550, 720, 0.045, 0, 'triangle']],
} satisfies Record<string, readonly Tone[]>;

function cueFor(event: StageVisualEvent): keyof typeof cues | null {
  switch (event.type) {
    case 'attack': return event.critical || event.strongHit ? 'crit' : 'hit';
    case 'heal': case 'buff_applied': return 'heal';
    case 'loot_drop': case 'chest_open': case 'victory': return 'pickup';
    case 'walk_start': return 'step';
    case 'item_used': return 'eat';
    case 'enemy_appear': case 'room_enter': return 'ui';
    default: return null;
  }
}

/** Presentation-only audio. Its pitch hash never consumes the simulation RNG. */
export class StageSoundPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastEventId = -1;
  private muted = true;

  update(frame: StageEventFrame, muted: boolean, paused: boolean): void {
    this.setMuted(muted);
    const event = frame.event;
    if (!event || event.id === this.lastEventId || paused) return;
    const impact = event.type === 'attack' ? 0.46 : event.type === 'item_used' ? 0.4 : 0;
    if (!frame.summary && frame.progress < impact) return;
    this.lastEventId = event.id;
    if (frame.summary || muted) return;
    const cue = cueFor(event);
    if (cue) this.play(cue, event.id);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.context && this.master) this.master.gain.setValueAtTime(muted ? 0 : 0.018, this.context.currentTime);
  }

  click(muted: boolean): void {
    this.setMuted(muted);
    this.play('ui', 0);
  }

  dispose(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
  }

  private play(cue: keyof typeof cues, cosmeticId: number): void {
    if (this.muted || typeof AudioContext === 'undefined') return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.018;
        this.master.connect(this.context.destination);
      }
      const context = this.context;
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
      const pitch = 0.97 + ((Math.imul(cosmeticId, 1664525) >>> 0) % 7) * 0.01;
      for (const [from, to, duration, delay, type] of cues[cue]) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        const at = context.currentTime + delay;
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(from * pitch, at);
        oscillator.frequency.exponentialRampToValueAtTime(to * pitch, at + duration);
        envelope.gain.setValueAtTime(0.001, at);
        envelope.gain.exponentialRampToValueAtTime(1, at + 0.006);
        envelope.gain.exponentialRampToValueAtTime(0.001, at + duration);
        oscillator.connect(envelope);
        envelope.connect(this.master!);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
        oscillator.start(at);
        oscillator.stop(at + duration);
      }
    } catch {
      // A browser audio policy or missing device must never interrupt the game.
    }
  }
}
