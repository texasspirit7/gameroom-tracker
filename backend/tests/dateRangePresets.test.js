import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Frontend code, but pure and dependency-free — and `npm test` is the only runner in the
// project, so it lives here rather than justifying a second test setup.
const { buildPresets } = await import('../../frontend/src/dateRange.js');

// DateRangeContext is .jsx, which Node cannot import without a loader — read the constant
// out of the source instead, which still catches the default drifting away from a real preset.
const contextSrc = fs.readFileSync(
  new URL('../../frontend/src/DateRangeContext.jsx', import.meta.url), 'utf8');
const DEFAULT_RANGE_KEY = contextSrc.match(/DEFAULT_RANGE_KEY\s*=\s*'([^']+)'/)?.[1];

const dayOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0 = Sunday, 1 = Monday
};
const daysBetween = (a, b) => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

const preset = (key) => buildPresets().find((p) => p.key === key);

// Asserted as invariants rather than fixed dates: buildPresets() reads the real clock, so
// hard-coded expectations would pass today and rot tomorrow.
describe('This Week — a whole Monday-to-Sunday week', () => {
  test('is offered, and labelled "This Week"', () => {
    assert.equal(preset('wtd')?.label, 'This Week');
  });

  test('starts on a Monday', () => {
    assert.equal(dayOf(preset('wtd').from), 1);
  });

  test('ends on the following Sunday, not today', () => {
    const { from, to } = preset('wtd');
    assert.equal(dayOf(to), 0, 'ends on a Sunday');
    assert.equal(daysBetween(from, to), 6, 'spans exactly seven days');
  });

  test('contains today', () => {
    const { from, to } = preset('wtd');
    const today = preset('today').from;
    assert.ok(from <= today && today <= to, `${today} should fall in ${from}..${to}`);
  });

  test('is the default range every page opens on', () => {
    assert.equal(DEFAULT_RANGE_KEY, 'wtd');
    assert.ok(preset(DEFAULT_RANGE_KEY), 'the default names a real preset');
  });
});

describe('the neighbouring week presets stay consistent', () => {
  test('Last Week is the full Monday-to-Sunday week before this one', () => {
    const wtd = preset('wtd');
    const last = preset('lastWeek');
    assert.equal(dayOf(last.from), 1, 'starts Monday');
    assert.equal(dayOf(last.to), 0, 'ends Sunday');
    assert.equal(daysBetween(last.from, last.to), 6);
    assert.equal(daysBetween(last.to, wtd.from), 1, 'runs up to the day before this week');
  });

  test('This Week and Last Week do not overlap', () => {
    assert.ok(preset('lastWeek').to < preset('wtd').from);
  });
});

describe('every preset is well-formed', () => {
  test('from is never after to, and All Time is open-ended', () => {
    for (const p of buildPresets()) {
      if (p.key === 'allTime') {
        assert.equal(p.from, null);
        assert.equal(p.to, null);
      } else {
        assert.ok(p.from <= p.to, `${p.key}: ${p.from} must not be after ${p.to}`);
      }
    }
  });

  test('keys are unique', () => {
    const keys = buildPresets().map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  // Guards the earlier decision that "This Month" means the whole calendar month.
  test('This Month still covers the whole calendar month', () => {
    const { from, to } = preset('mtd');
    assert.match(from, /-01$/, 'starts on the first');
    const [y, m] = to.split('-').map(Number);
    assert.equal(new Date(y, m, 0).getDate(), Number(to.slice(-2)), 'ends on the last day of the month');
  });
});
