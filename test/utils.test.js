import { describe, it } from 'node:test';
import assert from 'node:assert';
import { expandFills, resolveBatchRefs } from '../server/utils.js';

describe('expandFills', () => {
  it('should expand hex string to Figma Paint', () => {
    const result = expandFills('#ff0000');
    assert.deepStrictEqual(result, [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }]);
  });

  it('should expand hex array', () => {
    const result = expandFills(['#00ff00']);
    assert.strictEqual(result.length, 1);
    assert.ok(Math.abs(result[0].color.g - 1) < 0.01);
  });

  it('should pass through Figma Paint objects', () => {
    const paint = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.8 }];
    const result = expandFills(paint);
    assert.deepStrictEqual(result, paint);
  });

  it('should return undefined for undefined', () => {
    assert.strictEqual(expandFills(undefined), undefined);
  });

  it('should handle mixed arrays of hex and paint objects', () => {
    const input = ['#0000ff', { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    const result = expandFills(input);
    assert.strictEqual(result.length, 2);
    assert.ok(Math.abs(result[0].color.b - 1) < 0.01);
    assert.strictEqual(result[1].type, 'SOLID');
  });
});

describe('resolveBatchRefs', () => {
  it('should resolve $0.nodeId', () => {
    const results = [{ result: { nodeId: '1:23', name: 'Slide' } }];
    const params = { parentId: '$0.nodeId', text: 'Hello' };
    const resolved = resolveBatchRefs(params, results);
    assert.strictEqual(resolved.parentId, '1:23');
    assert.strictEqual(resolved.text, 'Hello');
  });

  it('should resolve multiple references', () => {
    const results = [
      { result: { nodeId: '1:23' } },
      { result: { nodeId: '1:24' } }
    ];
    const params = { a: '$0.nodeId', b: '$1.nodeId' };
    const resolved = resolveBatchRefs(params, results);
    assert.strictEqual(resolved.a, '1:23');
    assert.strictEqual(resolved.b, '1:24');
  });

  it('should resolve numeric values correctly', () => {
    const results = [{ result: { count: 42 } }];
    const params = { value: '$0.count' };
    const resolved = resolveBatchRefs(params, results);
    assert.strictEqual(resolved.value, 42);
  });

  it('should throw on failed reference', () => {
    const results = [{ error: { code: 'FAIL', message: 'oops' } }];
    assert.throws(() => resolveBatchRefs({ parentId: '$0.nodeId' }, results));
  });

  it('should throw on out-of-bounds reference', () => {
    const results = [];
    assert.throws(() => resolveBatchRefs({ parentId: '$0.nodeId' }, results));
  });

  it('should not touch non-reference strings', () => {
    const results = [{ result: { nodeId: '1:23' } }];
    const params = { text: 'Hello world', count: 5 };
    const resolved = resolveBatchRefs(params, results);
    assert.strictEqual(resolved.text, 'Hello world');
    assert.strictEqual(resolved.count, 5);
  });
});
