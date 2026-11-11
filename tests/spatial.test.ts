import { describe, expect, it } from 'vitest';
import {
  distanceCutoff,
  distanceGain,
  FAR,
  listenerPosition,
  NEAR,
  pan,
  reverbSend,
} from '../src/audio/spatial';

describe('áudio posicional', () => {
  it('perto fica no volume cheio, longe some e passa do limite não toca', () => {
    expect(distanceGain(0, NEAR)).toBe(1);
    expect(distanceGain(NEAR.ref, NEAR)).toBe(1);
    expect(distanceGain(12, NEAR)).toBeLessThan(distanceGain(6, NEAR));
    expect(distanceGain(NEAR.max, NEAR)).toBe(0);
    expect(distanceGain(NEAR.max * 0.99, NEAR)).toBeLessThan(0.01);
  });

  it('meteoro é ouvido bem mais longe que um passo', () => {
    expect(distanceGain(40, FAR)).toBeGreaterThan(0.1);
    expect(distanceGain(40, NEAR)).toBe(0);
  });

  it('longe soa mais grave e com mais eco', () => {
    expect(distanceCutoff(0, NEAR)).toBe(18000);
    expect(distanceCutoff(20, NEAR)).toBeLessThan(3000);
    expect(distanceCutoff(NEAR.max, NEAR)).toBeCloseTo(350);
    expect(reverbSend(20, NEAR)).toBeGreaterThan(reverbSend(1, NEAR));
  });

  it('o lado do som bate com o lado da tela, em qualquer giro da câmera', () => {
    const player = { x: 10, y: 20, z: -4 };
    for (const yaw of [Math.PI / 4, (3 * Math.PI) / 4, -Math.PI / 4, Math.PI]) {
      const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const right = { x: Math.cos(yaw), z: -Math.sin(yaw) }; // IsoRig.right()
      const l = listenerPosition(player, forward);
      expect(pan(l, forward, player)).toBeCloseTo(0); // no astronauta: centro
      expect(pan(l, forward, { x: player.x + right.x * 5, z: player.z + right.z * 5 })).toBeGreaterThan(0.5);
      expect(pan(l, forward, { x: player.x - right.x * 5, z: player.z - right.z * 5 })).toBeLessThan(-0.5);
    }
  });
});
