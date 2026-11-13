import endlessRules from '../data/endless-rules.json';
import { getEffectiveStats, getFormDefinition, getTraitDefinition } from './progression';
import type { Element, GameState, Stats } from './types';

export interface PetCodePayload {
  version: 1;
  name: string;
  formId: string;
  element: Element;
  generation: number;
  level: number;
  stats: Stats;
  traitIds: string[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const maximumEncodedCharacters = endlessRules.petCodes.maximumEncodedCharacters;
const maximumDecodedBytes = endlessRules.petCodes.maximumDecodedBytes;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Pet code contains invalid characters.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function blobFromBytes(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy]);
}

async function readLimited(stream: ReadableStream<Uint8Array>, maximumBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('Pet code expands beyond the safe size limit.');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function sanitizePetCodePayload(value: unknown): PetCodePayload | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.formId !== 'string') return null;
  const form = getFormDefinition(value.formId);
  if (!form) return null;
  const rawStats = isRecord(value.stats) ? value.stats : {};
  const maximumStat = endlessRules.petCodes.maximumStat;
  const stats: Stats = {
    HP: boundedInteger(rawStats.HP, 1, 1, maximumStat),
    ATK: boundedInteger(rawStats.ATK, 1, 1, maximumStat),
    DEF: boundedInteger(rawStats.DEF, 1, 1, maximumStat),
    SPD: boundedInteger(rawStats.SPD, 1, 1, maximumStat),
    LUK: boundedInteger(rawStats.LUK, 1, 1, maximumStat),
  };
  const traitIds = Array.isArray(value.traitIds)
    ? [...new Set(value.traitIds.filter((id): id is string => typeof id === 'string' && Boolean(getTraitDefinition(id))))].slice(0, endlessRules.petCodes.maximumTraits)
    : [];
  return {
    version: 1,
    name: form.name,
    formId: form.id,
    element: form.element,
    generation: boundedInteger(value.generation, 1, 1, endlessRules.petCodes.maximumGeneration),
    level: boundedInteger(value.level, 1, 1, endlessRules.petCodes.maximumLevel),
    stats,
    traitIds,
  };
}

export function createPetCodePayload(state: GameState): PetCodePayload | null {
  if (!state.evolution.formId) return null;
  return sanitizePetCodePayload({
    version: 1,
    formId: state.evolution.formId,
    generation: state.generation,
    level: state.level,
    stats: getEffectiveStats(state),
    traitIds: [
      ...state.evolution.traitIds,
      state.evolution.mutationTraitId,
      state.evolution.drawbackTraitId,
    ].filter((id): id is string => typeof id === 'string'),
  });
}

export async function encodePetCode(value: unknown): Promise<string> {
  const payload = sanitizePetCodePayload(value);
  if (!payload) throw new Error('This pet data is not valid for a share code.');
  const json = JSON.stringify(payload);
  const raw = encoder.encode(json);
  if (raw.byteLength > maximumDecodedBytes) throw new Error('Pet data is too large to share safely.');
  let prefix = 'PP1J.';
  let encoded: Uint8Array<ArrayBuffer> = raw;
  if (typeof CompressionStream !== 'undefined') {
    const stream = blobFromBytes(raw).stream().pipeThrough(new CompressionStream('gzip'));
    encoded = await readLimited(stream, maximumDecodedBytes);
    prefix = 'PP1G.';
  }
  const code = `${prefix}${toBase64Url(encoded)}`;
  if (code.length > maximumEncodedCharacters) throw new Error('The share code is longer than this game allows.');
  return code;
}

export async function decodePetCode(code: string): Promise<PetCodePayload> {
  if (typeof code !== 'string' || code.length === 0 || code.length > maximumEncodedCharacters) {
    throw new Error('Pet code is empty or longer than the safe limit.');
  }
  const compressed = code.startsWith('PP1G.');
  const plain = code.startsWith('PP1J.');
  if (!compressed && !plain) throw new Error('This is not a Pocket Pal pet code.');
  const bytes = fromBase64Url(code.slice(5));
  let decoded = bytes;
  if (compressed) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed pet codes.');
    const stream = blobFromBytes(bytes).stream().pipeThrough(new DecompressionStream('gzip'));
    decoded = await readLimited(stream, maximumDecodedBytes);
  } else if (bytes.byteLength > maximumDecodedBytes) {
    throw new Error('Pet code expands beyond the safe size limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(decoded));
  } catch {
    throw new Error('Pet code could not be read.');
  }
  const payload = sanitizePetCodePayload(parsed);
  if (!payload) throw new Error('Pet code contains an unknown form or invalid data.');
  return payload;
}
