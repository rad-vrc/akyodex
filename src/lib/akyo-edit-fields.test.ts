import assert from 'node:assert/strict';
import test from 'node:test';
import { getAkyoEditFields, mergeAkyoEditFields } from './akyo-edit-fields';

const fields = getAkyoEditFields({
  id: '2029', nickname: 'Test', avatarName: 'Test', category: '', comment: '',
  appearance: '', author: '', sourceUrl: '',
  attribute: '', notes: '', creator: '', avatarUrl: '',
});

function merge(base: string, mine: string, theirs: string, unregistered = new Set<string>()) {
  return mergeAkyoEditFields(
    { ...fields, category: base },
    { ...fields, category: mine },
    { ...fields, category: theirs },
    unregistered,
  );
}

test('a held category addition preserves an independent rename instead of reviving the old name', () => {
  const result = merge(
    'ファッション・装備,ファッション・装備/メガネ',
    'ファッション・装備,ファッション・装備/メガネ,行事・文化',
    'ファッション・装備,ファッション・装備/メガネ・サングラス',
  );
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.category, 'ファッション・装備,ファッション・装備/メガネ・サングラス,行事・文化');
});

test('category deltas preserve both editors additions and removals, with normalized ancestors', () => {
  const result = merge('A/Old,B/Old', 'A/New,B/Old', 'A/Old,B/New');
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.category, 'A,B,B/New,A/New');
});

test('an unrelated addition does not restore a category removed remotely', () => {
  const result = merge('A/Old,B', 'A/Old,B,C', 'B');
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.category, 'B,C');
});

test('overlapping additions and removals are idempotent', () => {
  const result = merge('A,B,C', 'A,D/Child', 'A,D/Child,E');
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.category, 'A,D,D/Child,E');
});

test('removing a retired name conflicts with a possible remote replacement', () => {
  const result = merge('A/Old,B', 'A,B', 'A/New,B', new Set(['A/Old']));
  assert.deepEqual(result.conflicts, ['category']);
  assert.equal(result.merged.category, 'A/New,B', 'a conflict does not partially apply the category edit');
});

test('retired names do not prevent identical results or unrelated additions from merging', () => {
  for (const [base, mine, theirs, expected] of [
    ['A,B', 'B,C', 'B,C', 'B,C'],
    ['A,B', 'B,C', 'B', 'B,C'],
    ['A,B', 'A,B,C', 'B,D', 'B,D,C'],
    ['A,B', 'B,A', 'B,D', 'B,D'],
  ]) {
    const result = merge(base, mine, theirs, new Set(['A']));
    assert.deepEqual(result.conflicts, [], `${base} -> ${mine} / ${theirs}`);
    assert.equal(result.merged.category, expected);
  }
});

test('removing a parent conflicts with the other editor adding a descendant in either direction', () => {
  for (const [mine, theirs] of [['B', 'A/Child,B'], ['A/Child,B', 'B']]) {
    const result = merge('A,B', mine, theirs);
    assert.deepEqual(result.conflicts, ['category']);
    assert.equal(result.merged.category, theirs, 'a conflict must not partially apply the category edit');
  }
  assert.deepEqual(merge('A/Child,B', 'A,B', 'A/Child/Grandchild,B').conflicts, ['category']);
});

test('hierarchy conflicts respect path boundaries and do not block sibling edits', () => {
  for (const [base, mine, theirs, expected] of [
    ['A,B', 'B', 'A,B,AB/Child', 'B,AB,AB/Child'],
    ['A/First,B', 'A,B', 'A/First,A/Second,B', 'A,A/Second,B'],
  ]) {
    const result = merge(base, mine, theirs);
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.merged.category, expected);
  }
});

test('reordering alone never rolls back a concurrent membership change', () => {
  assert.equal(merge('A,B', 'B,A', 'A,B').merged.category, 'B,A');
  const result = merge('A,B', 'B,A', 'A,C');
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.category, 'A,C');
});
