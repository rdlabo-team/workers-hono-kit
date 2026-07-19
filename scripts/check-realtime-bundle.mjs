#!/usr/bin/env node
import { stat } from 'node:fs/promises';

const bundlePath = process.argv[2] ?? 'dist-realtime/realtime-worker.js';
const maxBytes = Number(process.argv[3] ?? 32 * 1024);
if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
  throw new Error(`Invalid realtime bundle byte limit: ${process.argv[3]}`);
}

const { size } = await stat(bundlePath);
if (size > maxBytes) {
  throw new Error(`Realtime Worker bundle is ${size} bytes; expected at most ${maxBytes}`);
}
console.log(`[realtime-bundle] ${size} bytes (limit ${maxBytes})`);
