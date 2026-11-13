/// <reference lib="webworker" />
import rules from '../data/rules.json';
import { advanceWithSignals, applyAction, createInitialState } from './game';
import { collectStageEvents } from './stage-events';
import type { GameState, StageVisualEvent, WorkerInMessage, WorkerOutMessage } from './types';

const worker = self as DedicatedWorkerGlobalScope;
let state: GameState = createInitialState();
let ready = false;
let snapshotElapsedMs = 0;
let eventSequence = 0;
let pendingStageEvents: StageVisualEvent[] = [];

function send(message: WorkerOutMessage): void {
  worker.postMessage(message);
}

function snapshot(): void {
  send({ type: 'snapshot', state, events: pendingStageEvents });
  pendingStageEvents = [];
}

function queueStageEvents(previous: GameState, next: GameState): void {
  const events = collectStageEvents(previous, next);
  for (const event of events) pendingStageEvents.push({ ...event, id: ++eventSequence });
}

worker.addEventListener('message', (event: MessageEvent<WorkerInMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'load':
      state = { ...message.state, paused: message.startPaused };
      ready = true;
      snapshotElapsedMs = 0;
      eventSequence = 0;
      pendingStageEvents = [];
      snapshot();
      break;
    case 'tick': {
      if (!ready || state.paused) return;
      const previous = state;
      const result = advanceWithSignals(state, message.dtMs);
      state = result.state;
      queueStageEvents(previous, state);
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
      const previous = state;
      const result = applyAction(state, message.action);
      state = result.state;
      if (result.accepted) queueStageEvents(previous, state);
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
