import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeCategoryLists } from './admin-tabs';

test('mergeCategoryLists: categories registered but not yet on any Akyo become selectable', () => {
  assert.deepEqual(mergeCategoryLists(['動物', '動物/うま'], ['動物', '動物/ねこ', '乗り物']), ['乗り物', '動物', '動物/うま', '動物/ねこ']);
  assert.deepEqual(mergeCategoryLists(['動物'], []), ['動物']);
});
