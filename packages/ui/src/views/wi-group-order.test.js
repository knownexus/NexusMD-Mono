import { describe, it, expect } from 'vitest';
import { orderGroups, moveGroup } from './wi-group-order.js';

const g = (key, label, n) => ({ key, label, items: Array(n).fill(0) });
const groups = [g('bob', 'Bob', 1), g('unassigned', 'Unassigned', 5), g('amy', 'Amy', 3), g('me', 'Phil', 2)];
const keys = gs => gs.map(x => x.key);

describe('orderGroups', () => {
  it('leaves the default order alone', () => {
    expect(keys(orderGroups(groups, undefined))).toEqual(['bob', 'unassigned', 'amy', 'me']);
    expect(keys(orderGroups(groups, { mode: 'default' }))).toEqual(['bob', 'unassigned', 'amy', 'me']);
  });

  it('sorts by name either way', () => {
    expect(keys(orderGroups(groups, { mode: 'name' }))).toEqual(['amy', 'bob', 'me', 'unassigned']);
    expect(keys(orderGroups(groups, { mode: 'name-desc' }))).toEqual(['unassigned', 'me', 'bob', 'amy']);
  });

  it('sorts by item count, biggest first', () => {
    expect(keys(orderGroups(groups, { mode: 'count' }))).toEqual(['unassigned', 'amy', 'me', 'bob']);
  });

  it('follows a custom order, unlisted groups after in default order', () => {
    expect(keys(orderGroups(groups, { mode: 'custom', keys: ['me', 'amy'] }))).toEqual(['me', 'amy', 'bob', 'unassigned']);
  });

  it('does not change the input array', () => {
    orderGroups(groups, { mode: 'name' });
    expect(keys(groups)).toEqual(['bob', 'unassigned', 'amy', 'me']);
  });
});

describe('moveGroup', () => {
  it('moves a group and keeps saved keys that are not shown', () => {
    expect(moveGroup(['a', 'b', 'me'], ['x', 'a'], 2, 0)).toEqual({ mode: 'custom', keys: ['me', 'a', 'b', 'x'] });
  });

  it('ignores moves out of range or to the same place', () => {
    expect(moveGroup(['a', 'b'], [], 0, 0)).toBeNull();
    expect(moveGroup(['a', 'b'], [], 1, 2)).toBeNull();
  });
});
