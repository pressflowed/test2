// Headless check of how voices fade with distance. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceGain } from '../src/voice.js';

test('voices are full volume up close, fade with distance, and are gone far away', () => {
  assert.equal(voiceGain(0), 1);
  assert.equal(voiceGain(3), 1);
  assert.ok(voiceGain(9) > 0.4 && voiceGain(9) < 0.6, `9 m: ${voiceGain(9)}`);
  assert.ok(voiceGain(20) > 0.05 && voiceGain(20) < 0.2, `20 m: ${voiceGain(20)}`);
  assert.equal(voiceGain(40), 0);
  assert.equal(voiceGain(100), 0);
  for (let d = 0; d < 45; d += 0.5) assert.ok(voiceGain(d + 0.5) <= voiceGain(d) + 1e-9, `never gets louder further away (${d} m)`);
});
