export interface PauseHooks {
  pause: () => void;
  saveNow: () => void;
}

export function attachPauseHandlers(hooks: PauseHooks): () => void {
  const pauseAndSave = () => {
    hooks.pause();
    hooks.saveNow();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') pauseAndSave();
  };
  const onPageHide = () => pauseAndSave();
  const onBlur = () => pauseAndSave();

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('blur', onBlur);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('blur', onBlur);
  };
}
