export type SoundKind = 'eat' | 'play' | 'clean' | 'sleep' | 'wake' | 'hatch' | 'level' | 'enter' | 'descend' | 'loot' | 'victory' | 'bank';

type Note = {
  start: number;
  end: number;
  duration: number;
  delay?: number;
  volume?: number;
  type?: OscillatorType;
};

let context: AudioContext | null = null;

const patterns: Record<SoundKind, readonly Note[]> = {
  eat: [{ start: 620, end: 880, duration: 0.11, volume: 0.026 }],
  play: [
    { start: 520, end: 760, duration: 0.1, volume: 0.023, type: 'triangle' },
    { start: 780, end: 1040, duration: 0.12, delay: 0.075, volume: 0.022, type: 'triangle' },
  ],
  clean: [{ start: 740, end: 980, duration: 0.13, volume: 0.022, type: 'triangle' }],
  sleep: [{ start: 480, end: 320, duration: 0.2, volume: 0.024, type: 'triangle' }],
  wake: [{ start: 350, end: 640, duration: 0.18, volume: 0.024, type: 'triangle' }],
  hatch: [
    { start: 420, end: 560, duration: 0.15, volume: 0.028, type: 'triangle' },
    { start: 620, end: 820, duration: 0.17, delay: 0.11, volume: 0.027, type: 'triangle' },
    { start: 880, end: 1180, duration: 0.22, delay: 0.23, volume: 0.025, type: 'sine' },
  ],
  level: [
    { start: 520, end: 660, duration: 0.12, volume: 0.025, type: 'triangle' },
    { start: 780, end: 990, duration: 0.16, delay: 0.085, volume: 0.024, type: 'triangle' },
  ],
  enter: [
    { start: 580, end: 470, duration: 0.12, volume: 0.021, type: 'triangle' },
    { start: 440, end: 660, duration: 0.14, delay: 0.09, volume: 0.022, type: 'triangle' },
  ],
  descend: [
    { start: 620, end: 450, duration: 0.14, volume: 0.022, type: 'triangle' },
    { start: 390, end: 290, duration: 0.16, delay: 0.09, volume: 0.02, type: 'triangle' },
  ],
  loot: [
    { start: 760, end: 940, duration: 0.1, volume: 0.024, type: 'triangle' },
    { start: 980, end: 1320, duration: 0.16, delay: 0.07, volume: 0.022, type: 'sine' },
  ],
  victory: [
    { start: 520, end: 650, duration: 0.13, volume: 0.024, type: 'triangle' },
    { start: 660, end: 820, duration: 0.14, delay: 0.1, volume: 0.024, type: 'triangle' },
    { start: 880, end: 1100, duration: 0.2, delay: 0.21, volume: 0.023, type: 'sine' },
  ],
  bank: [
    { start: 720, end: 580, duration: 0.11, volume: 0.021, type: 'triangle' },
    { start: 520, end: 740, duration: 0.15, delay: 0.08, volume: 0.021, type: 'triangle' },
  ],
};

export function playSound(kind: SoundKind, muted: boolean): void {
  if (muted || typeof window === 'undefined' || !('AudioContext' in window)) return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const now = context.currentTime;
    patterns[kind].forEach((note) => {
      const startAt = now + (note.delay ?? 0);
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = note.type ?? 'square';
      oscillator.frequency.setValueAtTime(note.start, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(note.end, startAt + note.duration);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(note.volume ?? 0.024, startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + note.duration);
      oscillator.connect(gain);
      gain.connect(context!.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + note.duration);
    });
  } catch {
    // Audio is an enhancement; unsupported or blocked audio never interrupts care.
  }
}
