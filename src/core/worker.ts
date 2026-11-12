/// <reference lib="webworker" />
import rules from '../data/rules.json';
import { advanceWithSignals, applyAction, createInitialState } from './game';
import type { GameState, WorkerInMessage, WorkerOutMessage } from './types';

const worker = self as DedicatedWorkerGlobalScope;
let state: GameState = createInitialState();
let ready = false;
let snapshotElapsedMs = 0;

function send(message: WorkerOutMessage): void {
  worker.postMessage(message);
}

function snapshot(): void {
  send({ type: 'snapshot', state });
}

worker.addEventListener('message', (event: MessageEvent<WorkerInMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'load':
      state = { ...message.state, paused: message.startPaused };
      ready = true;
      snapshotElapsedMs = 0;
      snapshot();
      break;
    case 'tick': {
      if (!ready || state.paused) return;
      const result = advanceWithSignals(state, message.dtMs);
      state = result.state;
      if (result.signals.length) send({ type: 'signals', needs: result.signals });
      snapshotElapsedMs += Math.min(message.dtMs, rules.simulation.maxStepMs);
      if (snapshotElapsedMs >= rules.simulation.snapshotIntervalMs) {
        snapshotElapsedMs = 0;
        snapshot();
      }
      break;
    }
    case 'action': {
      if (!ready) return;
      const result = applyAction(state, message.action);
      state = result.state;
      send({
        type: 'action-result',
        result: {
          accepted: result.accepted,
          message: result.message,
          action: result.action,
        },
      });
      snapshot();
      break;
    }
    case 'pause':
      if (!ready) return;
      state = { ...state, paused: true };
      snapshot();
      break;
    case 'resume':
      if (!ready) return;
      state = { ...state, paused: false };
      snapshot();
      break;
    case 'save':
      if (!ready) return;
      send({ type: 'save', requestId: message.requestId, state });
      break;
  }
});
