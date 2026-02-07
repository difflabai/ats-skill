import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeString, parsePriority, parseSortField } from '../index.js';

// ============================================================================
// parseTimeString
// ============================================================================

describe('parseTimeString', () => {
  it('returns null for empty input', () => {
    assert.equal(parseTimeString(null), null);
    assert.equal(parseTimeString(undefined), null);
    assert.equal(parseTimeString(''), null);
  });

  it('parses relative minutes', () => {
    const before = Date.now();
    const result = new Date(parseTimeString('30m')).getTime();
    const after = Date.now();
    // Should be ~30 minutes ago (with small tolerance)
    assert.ok(result >= before - 30 * 60 * 1000 - 1000);
    assert.ok(result <= after - 30 * 60 * 1000 + 1000);
  });

  it('parses relative hours', () => {
    const before = Date.now();
    const result = new Date(parseTimeString('4h')).getTime();
    const after = Date.now();
    assert.ok(result >= before - 4 * 60 * 60 * 1000 - 1000);
    assert.ok(result <= after - 4 * 60 * 60 * 1000 + 1000);
  });

  it('parses relative days', () => {
    const before = Date.now();
    const result = new Date(parseTimeString('1d')).getTime();
    const after = Date.now();
    assert.ok(result >= before - 24 * 60 * 60 * 1000 - 1000);
    assert.ok(result <= after - 24 * 60 * 60 * 1000 + 1000);
  });

  it('parses relative weeks', () => {
    const before = Date.now();
    const result = new Date(parseTimeString('2w')).getTime();
    const after = Date.now();
    assert.ok(result >= before - 14 * 24 * 60 * 60 * 1000 - 1000);
    assert.ok(result <= after - 14 * 24 * 60 * 60 * 1000 + 1000);
  });

  it('parses relative months (capital M)', () => {
    const result = new Date(parseTimeString('3M'));
    const expected = new Date();
    expected.setMonth(expected.getMonth() - 3);
    // Allow 2 second tolerance
    assert.ok(Math.abs(result.getTime() - expected.getTime()) < 2000);
  });

  it('parses "today" as start of today', () => {
    const result = new Date(parseTimeString('today'));
    const expected = new Date();
    expected.setHours(0, 0, 0, 0);
    assert.equal(result.getTime(), expected.getTime());
  });

  it('parses "yesterday" as start of yesterday', () => {
    const result = new Date(parseTimeString('yesterday'));
    const expected = new Date();
    expected.setDate(expected.getDate() - 1);
    expected.setHours(0, 0, 0, 0);
    assert.equal(result.getTime(), expected.getTime());
  });

  it('passes through ISO date (YYYY-MM-DD)', () => {
    const result = parseTimeString('2025-01-15');
    const d = new Date(result);
    assert.equal(d.getFullYear(), 2025);
    assert.equal(d.getMonth(), 0); // January
    assert.equal(d.getDate(), 15);
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
  });

  it('passes through ISO timestamp', () => {
    const input = '2025-01-15T09:00:00Z';
    const result = parseTimeString(input);
    assert.equal(result, new Date(input).toISOString());
  });

  it('returns valid ISO string for all formats', () => {
    for (const input of ['30m', '4h', '1d', '2w', '3M', 'today', 'yesterday', '2025-01-15']) {
      const result = parseTimeString(input);
      assert.ok(result, `Expected result for "${input}"`);
      assert.ok(!isNaN(new Date(result).getTime()), `Expected valid date for "${input}", got "${result}"`);
    }
  });

  it('throws on invalid format', () => {
    assert.throws(() => parseTimeString('abc'), /Invalid time format/);
    assert.throws(() => parseTimeString('5x'), /Invalid time format/);
    assert.throws(() => parseTimeString('--1d'), /Invalid time format/);
  });
});

// ============================================================================
// parsePriority
// ============================================================================

describe('parsePriority', () => {
  it('returns empty object for empty input', () => {
    assert.deepEqual(parsePriority(null), {});
    assert.deepEqual(parsePriority(undefined), {});
    assert.deepEqual(parsePriority(''), {});
  });

  it('parses exact priority', () => {
    assert.deepEqual(parsePriority('8'), { priority: 8 });
    assert.deepEqual(parsePriority('1'), { priority: 1 });
    assert.deepEqual(parsePriority('10'), { priority: 10 });
  });

  it('parses min priority (N+)', () => {
    assert.deepEqual(parsePriority('7+'), { min_priority: 7 });
    assert.deepEqual(parsePriority('1+'), { min_priority: 1 });
  });

  it('parses priority range (N-M)', () => {
    assert.deepEqual(parsePriority('5-8'), { min_priority: 5, max_priority: 8 });
    assert.deepEqual(parsePriority('1-10'), { min_priority: 1, max_priority: 10 });
    assert.deepEqual(parsePriority('3-3'), { min_priority: 3, max_priority: 3 });
  });

  it('throws on out-of-range values', () => {
    assert.throws(() => parsePriority('0'), /Invalid priority/);
    assert.throws(() => parsePriority('11'), /Invalid priority/);
    assert.throws(() => parsePriority('0+'), /Priority must be between 1 and 10/);
    assert.throws(() => parsePriority('11+'), /Priority must be between 1 and 10/);
    assert.throws(() => parsePriority('0-5'), /Priority must be between 1 and 10/);
    assert.throws(() => parsePriority('5-11'), /Priority must be between 1 and 10/);
  });

  it('throws on inverted range', () => {
    assert.throws(() => parsePriority('8-5'), /min must be <= max/);
  });

  it('throws on invalid format', () => {
    assert.throws(() => parsePriority('abc'), /Invalid priority/);
    assert.throws(() => parsePriority('high'), /Invalid priority/);
  });
});

// ============================================================================
// parseSortField
// ============================================================================

describe('parseSortField', () => {
  it('maps "created" to "created_at"', () => {
    assert.equal(parseSortField('created'), 'created_at');
  });

  it('maps "updated" to "updated_at"', () => {
    assert.equal(parseSortField('updated'), 'updated_at');
  });

  it('maps "priority" to "priority"', () => {
    assert.equal(parseSortField('priority'), 'priority');
  });

  it('maps "title" to "title"', () => {
    assert.equal(parseSortField('title'), 'title');
  });

  it('throws on invalid sort field', () => {
    assert.throws(() => parseSortField('foo'), /Invalid sort field.*Must be one of/);
    assert.throws(() => parseSortField('created_at'), /Invalid sort field/);
    assert.throws(() => parseSortField('id'), /Invalid sort field/);
  });
});
