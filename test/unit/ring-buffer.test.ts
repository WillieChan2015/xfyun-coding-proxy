import { describe, it, expect } from 'bun:test';
import { RingBuffer } from '../../src/stats-store';

describe('RingBuffer', () => {
  it('should initialize with capacity', () => {
    const buf = new RingBuffer<number>(3);
    expect(buf.length).toBe(0);
    expect(buf.version).toBe(0);
  });

  it('should push items up to capacity', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.length).toBe(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
  });

  it('should overwrite oldest when capacity exceeded', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.length).toBe(3);
    expect(buf.toArray()).toEqual([2, 3, 4]);
  });

  it('should handle capacity of 1', () => {
    const buf = new RingBuffer<number>(1);
    buf.push(1);
    buf.push(2);
    expect(buf.length).toBe(1);
    expect(buf.toArray()).toEqual([2]);
  });

  it('should track version correctly', () => {
    const buf = new RingBuffer<number>(3);
    expect(buf.version).toBe(0);
    buf.push(1);
    expect(buf.version).toBe(1);
    buf.push(2);
    expect(buf.version).toBe(2);
    buf.push(3);
    expect(buf.version).toBe(3);
    buf.push(4);
    expect(buf.version).toBe(4);
  });

  it('should maintain correct order after multiple overwrites', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    buf.push(5);
    buf.push(6);
    buf.push(7);
    expect(buf.toArray()).toEqual([5, 6, 7]);
  });

  it('should handle string type', () => {
    const buf = new RingBuffer<string>(2);
    buf.push('a');
    buf.push('b');
    expect(buf.toArray()).toEqual(['a', 'b']);
    buf.push('c');
    expect(buf.toArray()).toEqual(['b', 'c']);
  });

  it('should handle object type', () => {
    const buf = new RingBuffer<{ id: number }>(2);
    buf.push({ id: 1 });
    buf.push({ id: 2 });
    expect(buf.toArray()).toEqual([{ id: 1 }, { id: 2 }]);
    buf.push({ id: 3 });
    expect(buf.toArray()).toEqual([{ id: 2 }, { id: 3 }]);
  });
});
