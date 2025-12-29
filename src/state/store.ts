import type { Params } from '../model/types';
import { defaults } from './params';

let state: Params = { ...defaults };
const listeners: Array<(p: Params) => void> = [];

export function getParams(): Params {
  return { ...state };
}

export function setParams(updates: Partial<Params>): void {
  state = { ...state, ...updates };
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn: (p: Params) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function reset(): void {
  state = { ...defaults };
  listeners.forEach((fn) => fn(state));
}
