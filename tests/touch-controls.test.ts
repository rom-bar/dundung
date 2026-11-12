import { describe, expect, it } from 'vitest';
import { PointerControlState } from '../src/platform/touch-controls';

describe('touch control pointer state', () => {
  it('tracks independent controls held by multiple pointers', () => {
    const pointers = new PointerControlState<string>();

    pointers.press(1, 'feed:moonberry');
    pointers.press(2, 'play');

    expect(pointers.isHeld('feed:moonberry')).toBe(true);
    expect(pointers.isHeld('play')).toBe(true);
    expect(pointers.isHeld('clean')).toBe(false);
  });

  it('keeps a control pressed until its last pointer is released', () => {
    const pointers = new PointerControlState<string>();

    pointers.press(1, 'play');
    pointers.press(2, 'play');
    expect(pointers.release(1)).toBe('play');
    expect(pointers.isHeld('play')).toBe(true);
    expect(pointers.release(2)).toBe('play');
    expect(pointers.isHeld('play')).toBe(false);
  });

  it('releases all held controls after blur or visibility loss', () => {
    const pointers = new PointerControlState<string>();

    pointers.press(1, 'feed:dew-drop');
    pointers.press(2, 'sleep');

    expect(pointers.releaseAll()).toEqual(['feed:dew-drop', 'sleep']);
    expect(pointers.isHeld('feed:dew-drop')).toBe(false);
    expect(pointers.isHeld('sleep')).toBe(false);
    expect(pointers.release(1)).toBeUndefined();
  });

  it('clears a previous control when a pointer is reassigned', () => {
    const pointers = new PointerControlState<string>();

    pointers.press(7, 'play');
    expect(pointers.press(7, 'clean')).toBe('play');
    expect(pointers.isHeld('play')).toBe(false);
    expect(pointers.isHeld('clean')).toBe(true);
  });
});
