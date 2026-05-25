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

  describe('updateFirst', () => {
    it('updates matching entry when buffer is not full', () => {
      const buf = new RingBuffer<{ id: number; val: string }>(3);
      buf.push({ id: 1, val: 'a' });
      buf.push({ id: 2, val: 'b' });
      const found = buf.updateFirst(
        (e) => e.id === 2,
        (e) => ({ ...e, val: 'updated' }),
      );
      expect(found).toBe(true);
      expect(buf.toArray()).toEqual([
        { id: 1, val: 'a' },
        { id: 2, val: 'updated' },
      ]);
    });

    it('updates matching entry when buffer is full (wrapped)', () => {
      const buf = new RingBuffer<{ id: number; val: string }>(3);
      buf.push({ id: 1, val: 'a' });
      buf.push({ id: 2, val: 'b' });
      buf.push({ id: 3, val: 'c' });
      buf.push({ id: 4, val: 'd' });
      const found = buf.updateFirst(
        (e) => e.id === 3,
        (e) => ({ ...e, val: 'updated' }),
      );
      expect(found).toBe(true);
      expect(buf.toArray()).toEqual([
        { id: 2, val: 'b' },
        { id: 3, val: 'updated' },
        { id: 4, val: 'd' },
      ]);
    });

    it('returns false when no entry matches', () => {
      const buf = new RingBuffer<{ id: number }>(3);
      buf.push({ id: 1 });
      buf.push({ id: 2 });
      const found = buf.updateFirst(
        (e) => e.id === 99,
        (e) => ({ ...e, id: 0 }),
      );
      expect(found).toBe(false);
      expect(buf.toArray()).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('increments version on successful update', () => {
      const buf = new RingBuffer<{ id: number }>(3);
      buf.push({ id: 1 });
      const vBefore = buf.version;
      buf.updateFirst(
        (e) => e.id === 1,
        (e) => ({ ...e, id: 10 }),
      );
      expect(buf.version).toBe(vBefore + 1);
    });

    it('does not increment version when no match', () => {
      const buf = new RingBuffer<{ id: number }>(3);
      buf.push({ id: 1 });
      const vBefore = buf.version;
      buf.updateFirst(
        (e) => e.id === 99,
        (e) => e,
      );
      expect(buf.version).toBe(vBefore);
    });

    it('returns false on empty buffer', () => {
      const buf = new RingBuffer<{ id: number }>(3);
      const found = buf.updateFirst(
        (e) => e.id === 1,
        (e) => e,
      );
      expect(found).toBe(false);
    });

    it('updates only the first match', () => {
      const buf = new RingBuffer<{ id: number; val: string }>(4);
      buf.push({ id: 1, val: 'a' });
      buf.push({ id: 1, val: 'b' });
      buf.push({ id: 1, val: 'c' });
      const found = buf.updateFirst(
        (e) => e.id === 1,
        (e) => ({ ...e, val: 'updated' }),
      );
      expect(found).toBe(true);
      const arr = buf.toArray();
      expect(arr.filter((e) => e.val === 'updated').length).toBe(1);
    });
  });
});
