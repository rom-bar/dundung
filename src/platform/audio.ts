export type SoundKind = 'eat' | 'play' | 'clean' | 'sleep' | 'wake';

let context: AudioContext | null = null;

const notes: Record<SoundKind, { start: number; end: number; duration: number }> = {
  eat: { start: 620, end: 880, duration: 0.11 },
  play: { start: 520, end: 1040, duration: 0.18 },
  clean: { start: 740, end: 980, duration: 0.13 },
  sleep: { start: 480, end: 320, duration: 0.2 },
  wake: { start: 350, end: 640, duration: 0.18 },
};

export function playSound(kind: SoundKind, muted: boolean): void {
  if (muted || typeof window === 'undefined' || !('AudioContext' in window)) return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const note = notes[kind];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(note.start, now);
    oscillator.frequency.exponentialRampToValueAtTime(note.end, now + note.duration);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + note.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + note.duration);
  } catch {
    // Audio is an enhancement; unsupported or blocked audio never interrupts care.
  }
}
