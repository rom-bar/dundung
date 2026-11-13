import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/game';
import { createEmptyEquipment, createEquipmentItem } from '../src/core/equipment';
import { drawPetScene } from '../src/render/sprite';

interface PaintedRect { x: number; y: number; width: number; height: number; color: string }

function makeGear(templateId: string, rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic'): NonNullable<ReturnType<typeof createEquipmentItem>> {
  const item = createEquipmentItem(templateId, rarity, 8, () => 0.5, `sprite-${templateId}`);
  if (!item) throw new Error(`Missing test template ${templateId}`);
  return item;
}

describe('equipped gear sprites', () => {
  it('draws distinct rarity-colored overlays for weapon, armor, hat and charm', () => {
    const painted: PaintedRect[] = [];
    let fillColor = '';
    const context = {
      imageSmoothingEnabled: false,
      get fillStyle() { return fillColor; },
      set fillStyle(value: string) { fillColor = value; },
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillRect(x: number, y: number, width: number, height: number) {
        painted.push({ x, y, width, height, color: fillColor });
      },
      save() {},
      restore() {},
      translate() {},
      scale() {},
      fillText() {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
    const base = createInitialState(3);
    const equipment = createEmptyEquipment();
    const state = {
      ...base,
      stage: 'adult' as const,
      evolution: { ...base.evolution, formId: 'fire-emberguard' },
      equipment: {
        ...equipment,
        equipped: {
          Weapon: makeGear('emberfang-pick', 'Common'),
          Armor: makeGear('coalcap-plate', 'Uncommon'),
          Hat: makeGear('lanternmole-hood', 'Rare'),
          Charm: makeGear('warmstone-knot', 'Epic'),
        },
      },
    };

    drawPetScene(canvas, state, 0, true);

    const colors = new Set(painted.map((rect) => rect.color));
    expect(colors).toContain('#c9c2d0');
    expect(colors).toContain('#abdfb4');
    expect(colors).toContain('#f1c96b');
    expect(colors).toContain('#c89be8');
    expect(painted.some((rect) => rect.x < 95 && rect.width === 5)).toBe(true);
  });
});
