'use strict';

/**
 * Pure RFC-4180-compliant CSV serialization.
 *
 * Contract:
 *   - headers: [{ key, label }] — column order and header labels.
 *   - rows:    array of plain objects keyed by header.key.
 *   - Fields containing a comma, double-quote, CR or LF are wrapped in
 *     double-quotes; embedded double-quotes are doubled ("").
 *   - Lines always end with CRLF (\r\n), including the last one.
 *   - null/undefined render as empty fields.
 *
 * Deliberately dependency-free and side-effect-free so it stays trivially
 * unit-testable (see tests/csv-export.test.js).
 */

const needsQuoting = /[",\r\n]/;

const escapeField = (value) => {
    const s = value === null || value === undefined ? '' : String(value);
    if (!needsQuoting.test(s)) return s;
    return `"${s.replace(/"/g, '""')}"`;
};

const toCsv = (rows, headers) => {
    const lines = [headers.map((h) => escapeField(h.label)).join(',')];
    for (const row of rows) {
        lines.push(headers.map((h) => escapeField(row ? row[h.key] : '')).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
};

module.exports = { toCsv };
