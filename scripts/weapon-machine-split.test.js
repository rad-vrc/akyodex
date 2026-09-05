const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');

const machineIds = [
  '0024',
  '0028',
  '0072',
  '0078',
  '0147',
  '0148',
  '0373',
  '0375',
  '0397',
  '0511',
  '0524',
  '0585',
  '0820',
];

const weaponIds = [
  '0207',
  '0332',
  '0333',
  '0357',
  '0510',
  '0541',
  '0550',
  '0594',
  '0595',
  '0611',
  '0631',
  '0845',
];

function splitCategories(value) {
  return String(value || '')
    .split(',')
    .map((category) => category.trim())
    .filter(Boolean);
}

function assertAncestors(categories, category) {
  const parts = category.split('/');
  for (let depth = 1; depth < parts.length; depth += 1) {
    const ancestor = parts.slice(0, depth).join('/');
    assert.ok(categories.includes(ancestor), `${category} should include ${ancestor}`);
  }
}

test('keeps Vectorize aligned with the machine and weapon assignments', () => {
  const records = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'vectorize-payload.json'), 'utf8'),
  );
  const recordsById = new Map(records.map((record) => [record.id, record]));

  for (const record of records) {
    const categories = splitCategories(record.category);
    assert.ok(!categories.includes('武器・機械'));
    assert.ok(!categories.includes('武器・軍事'));
    assert.ok(
      !categories.some(
        (category) => category === 'ファッション' || category.startsWith('ファッション/'),
      ),
    );
  }

  for (const id of machineIds.filter((value) => recordsById.has(value))) {
    const categories = splitCategories(recordsById.get(id).category);
    assert.ok(categories.includes('機械'), `Vectorize ID ${id} should be Machine`);
    assert.ok(!categories.includes('ファッション・装備/武器'));
  }

  for (const id of weaponIds.filter((value) => recordsById.has(value))) {
    const categories = splitCategories(recordsById.get(id).category);
    assert.ok(categories.includes('ファッション・装備/武器'), `Vectorize ID ${id} should be Weapon`);
    assertAncestors(categories, 'ファッション・装備/武器');
    assert.ok(!categories.includes('機械'));
  }

  const missile = recordsById.get('0510');
  assert.ok(missile);
  assert.ok(splitCategories(missile.category).includes('危険物'));
});
