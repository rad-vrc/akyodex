import assert from 'node:assert/strict';
import test from 'node:test';
import { needsReducedEffects } from './rendering-capability';

function probe(result: 'hardware' | 'unavailable' | 'lost' | 'throws', cleanupThrows = false, renderer = 'Hardware GPU', debugInfo = true) {
  let released = 0;
  let calls = 0;
  const canvas = {
    width: 0, height: 0,
    getContext(type: string, options: WebGLContextAttributes) {
      calls++;
      assert.equal(type, 'webgl');
      assert.equal(options.failIfMajorPerformanceCaveat, true);
      assert.equal(options.antialias, false);
      assert.equal(canvas.width, 1);
      assert.equal(canvas.height, 1);
      if (result === 'throws') throw new Error('Context creation blocked');
      if (result === 'unavailable') return null;
      return {
        RENDERER: 7937,
        getParameter: () => renderer,
        isContextLost: () => result === 'lost',
        getExtension(name: string) {
          if (name === 'WEBGL_debug_renderer_info') return debugInfo ? { UNMASKED_RENDERER_WEBGL: 37446 } : null;
          assert.equal(name, 'WEBGL_lose_context');
          if (cleanupThrows) throw new Error('Context cleanup unavailable');
          return { loseContext() { released++; } };
        },
      };
    },
  };
  const reduced = needsReducedEffects(() => canvas as unknown as HTMLCanvasElement);
  return { reduced, released, calls };
}

test('a usable context keeps decorations and immediately releases the one-pixel probe', () => {
  assert.deepEqual(probe('hardware'), { reduced: false, released: 1, calls: 1 });
});

test('unavailable, lost or blocked graphics contexts reduce decorations without throwing', () => {
  assert.deepEqual(probe('unavailable'), { reduced: true, released: 0, calls: 1 });
  assert.deepEqual(probe('lost'), { reduced: true, released: 1, calls: 1 });
  assert.deepEqual(probe('throws'), { reduced: true, released: 0, calls: 1 });
  assert.equal(needsReducedEffects(() => { throw new Error('No canvas'); }), true);
});

test('cleanup failure does not reverse a successful capability check', () => {
  assert.deepEqual(probe('hardware', true), { reduced: false, released: 0, calls: 1 });
});

test('software fallback is reduced even when major-performance-caveat was ignored', () => {
  for (const renderer of ['ANGLE (Google, SwiftShader Device)', 'llvmpipe', 'softpipe', 'Software Rasterizer', 'Microsoft Basic Render Driver']) {
    assert.equal(probe('hardware', false, renderer).reduced, true, renderer);
  }
});

test('private renderer information is optional; unknown usable contexts retain normal effects', () => {
  assert.equal(probe('hardware', false, 'WebKit WebGL', false).reduced, false);
  assert.equal(probe('hardware', false, 'SwiftShader', false).reduced, true);
});
