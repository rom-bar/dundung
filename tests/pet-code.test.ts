import { describe, expect, it } from 'vitest';
import { simulateGhostBattle } from '../src/core/ghost-battle';
import { createInitialState } from '../src/core/game';
import { createPetCodePayload, decodePetCode, encodePetCode, sanitizePetCodePayload } from '../src/core/pet-code';
import { getAllForms } from '../src/core/progression';

function liveState() {
  const state = createInitialState(73);
  return {
    ...state,
    stage: 'adult' as const,
    level: 12,
    evolution: { ...state.evolution, formId: 'fire-emberguard' },
  };
}

describe('Pocket Pal share codes', () => {
  it('round-trips a valid local pet using a versioned compressed code', async () => {
    const payload = createPetCodePayload(liveState());
    expect(payload).not.toBeNull();
    const code = await encodePetCode(payload);
    expect(code.startsWith('PP1G.') || code.startsWith('PP1J.')).toBe(true);
    expect(await decodePetCode(code)).toEqual(payload);
  });

  it('sanitizes imported stats, level, generation and traits before battle', () => {
    const safe = sanitizePetCodePayload({
      version: 1,
      formId: 'fire-emberguard',
      generation: -2,
      level: 999,
      stats: { HP: 1e12, ATK: -5, DEF: 8.8, SPD: 'fast', LUK: 2 },
      traitIds: ['unknown-trait'],
    });
    expect(safe).toMatchObject({ generation: 1, level: 40, name: 'Emberguard', element: 'fire', traitIds: [] });
    expect(safe?.stats).toEqual({ HP: 5000, ATK: 1, DEF: 8, SPD: 1, LUK: 2 });
  });

  it('rejects malformed, overlong and unknown-form codes', async () => {
    await expect(decodePetCode('not-a-code')).rejects.toThrow('not a Pocket Pal');
    await expect(decodePetCode(`PP1J.${'A'.repeat(4100)}`)).rejects.toThrow('safe limit');
    const raw = btoa(JSON.stringify({ version: 1, formId: 'made-up-form', stats: {} }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    await expect(decodePetCode(`PP1J.${raw}`)).rejects.toThrow('unknown form');
  });
});

describe('Ghost battles', () => {
  it('runs deterministic, local-only battles with bounded turns and log output', () => {
    const pal = createPetCodePayload(liveState())!;
    const otherForm = getAllForms().find((form) => form.id !== pal.formId)!;
    const ghost = sanitizePetCodePayload({
      version: 1,
      formId: otherForm.id,
      generation: 3,
      level: 10,
      stats: { HP: 110, ATK: 22, DEF: 15, SPD: 18, LUK: 4 },
      traitIds: [],
    })!;
    const first = simulateGhostBattle(pal, ghost, 9001);
    const second = simulateGhostBattle(pal, ghost, 9001);
    expect(first).toEqual(second);
    expect(['pocket-pal', 'ghost', 'draw']).toContain(first.winner);
    expect(first.turns).toBeGreaterThan(0);
    expect(first.turns).toBeLessThanOrEqual(24);
    expect(first.log.length).toBeLessThanOrEqual(12);
    expect(first.pocketPalHp).toBeGreaterThanOrEqual(0);
    expect(first.ghostHp).toBeGreaterThanOrEqual(0);
  });
});
