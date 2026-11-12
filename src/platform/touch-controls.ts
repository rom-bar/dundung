export class PointerControlState<T> {
  private readonly pointers = new Map<number, T>();

  press(pointerId: number, control: T): T | undefined {
    const previous = this.pointers.get(pointerId);
    this.pointers.set(pointerId, control);
    return previous;
  }

  release(pointerId: number): T | undefined {
    const control = this.pointers.get(pointerId);
    this.pointers.delete(pointerId);
    return control;
  }

  isHeld(control: T): boolean {
    return [...this.pointers.values()].includes(control);
  }

  releaseAll(): T[] {
    const controls = [...new Set(this.pointers.values())];
    this.pointers.clear();
    return controls;
  }
}

export interface TouchControlsOptions {
  root: HTMLElement;
  onActivate: (button: HTMLButtonElement) => void;
  hapticsEnabled?: () => boolean;
  vibrate?: () => void;
  selector?: string;
}

/**
 * Connect discrete care actions to pointerdown. These actions intentionally do
 * not repeat while held: feeding, playing, sleeping, and cleaning are one-shot
 * choices with their own in-game cooldowns.
 */
export function attachTouchControls(options: TouchControlsOptions): () => void {
  const { root } = options;
  const selector = options.selector ?? 'button[data-action]';
  const pointers = new PointerControlState<HTMLButtonElement>();
  const pointerActivations = new WeakMap<HTMLButtonElement, number>();

  const resolveButton = (target: EventTarget | null): HTMLButtonElement | null => {
    if (!(target instanceof Element)) return null;
    const button = target.closest<HTMLButtonElement>(selector);
    return button && root.contains(button) ? button : null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    const button = resolveButton(event.target);
    if (!button || button.disabled) return;

    const previous = pointers.press(event.pointerId, button);
    if (previous && !pointers.isHeld(previous)) previous.classList.remove('is-pressed');
    button.classList.add('is-pressed');
    pointerActivations.set(button, performance.now());

    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events and a few browser implementations cannot capture here.
    }

    options.onActivate(button);
    if (event.pointerType === 'touch' && options.hapticsEnabled?.()) {
      (options.vibrate ?? (() => navigator.vibrate?.(10)))();
    }
  };

  const releasePointer = (pointerId: number): void => {
    const button = pointers.release(pointerId);
    if (button && !pointers.isHeld(button)) button.classList.remove('is-pressed');
  };

  const releaseAll = (): void => {
    pointers.releaseAll().forEach((button) => button.classList.remove('is-pressed'));
  };

  const onPointerUp = (event: PointerEvent): void => releasePointer(event.pointerId);
  const onPointerLeave = (event: PointerEvent): void => releasePointer(event.pointerId);
  const onBlur = (): void => releaseAll();
  const onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') releaseAll();
  };
  const onContextMenu = (event: MouseEvent): void => {
    if (resolveButton(event.target)) event.preventDefault();
  };
  const suppressPointerClick = (event: MouseEvent): void => {
    const button = resolveButton(event.target);
    if (!button || event.detail === 0) return;
    const activatedAt = pointerActivations.get(button);
    if (activatedAt === undefined || performance.now() - activatedAt > 1200) return;
    pointerActivations.delete(button);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('pointerleave', onPointerLeave);
  root.addEventListener('click', suppressPointerClick, true);
  root.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    releaseAll();
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerUp);
    root.removeEventListener('pointerleave', onPointerLeave);
    root.removeEventListener('click', suppressPointerClick, true);
    root.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
