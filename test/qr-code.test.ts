/** QrCode holds the UTF-8 bytes of its text, and says plainly when the text does not fit. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { createElement as h } from 'react';
import qrcode from 'qrcode-generator';
import { QrCode } from '../index.js';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(() => cleanup());

const MAX_BYTES = 2331;

/** The path `QrCode` draws for `value`, or null for a tile with no modules. */
function drawn(value: string): { d: string; error: string | null } {
  const m = mount(h(QrCode, { value, label: 'code' }));
  const svg = m.container.querySelector('svg')!;
  const d = svg.querySelector('path')!.getAttribute('d')!;
  const error = svg.getAttribute('data-phonux-qr-error');
  m.unmount();
  return { d, error };
}

/** The path for a code whose payload is `bytes`, built straight from the generator with one character per byte. */
function pathOfBytes(bytes: Buffer): string {
  const code = qrcode(0, 'M');
  code.addData(bytes.toString('latin1'));
  code.make();
  const count = code.getModuleCount();
  let d = '';
  for (let y = 0; y < count; y += 1) for (let x = 0; x < count; x += 1) if (code.isDark(y, x)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  return d;
}

test('control: two different ASCII texts draw different codes, and ASCII is unchanged by the UTF-8 encoding', () => {
  assert.notEqual(drawn('A').d, drawn('B').d);
  assert.equal(drawn('KW-7Q4M-ZX2P').d, pathOfBytes(Buffer.from('KW-7Q4M-ZX2P', 'utf8')));
});

test('text outside Latin-1 draws its own code, not the code of the low bytes of its characters', () => {
  assert.notEqual(drawn('Ł').d, drawn('A').d, 'U+0141 is not "A"');
  assert.notEqual(drawn('€').d, drawn('¬').d, 'U+20AC is not U+00AC');
  const link = 'https://example.com/日本';
  assert.notEqual(drawn(link).d, drawn(`https://example.com/${String.fromCharCode(0x65e5 & 0xff, 0x672c & 0xff)}`).d);
});

test('the code holds the UTF-8 bytes of the text, for Latin-1, other scripts and an emoji', () => {
  for (const value of ['café', 'Łódź', 'https://example.com/日本', 'party \u{1F389}']) {
    assert.equal(drawn(value).d, pathOfBytes(Buffer.from(value, 'utf8')), value);
  }
});

test('2331 bytes fit; 2332 bytes draw an empty tile marked too-long instead of throwing', () => {
  const fits = drawn('a'.repeat(MAX_BYTES));
  assert.ok(fits.d.length > 1000);
  assert.equal(fits.error, null);
  const over = drawn('a'.repeat(MAX_BYTES + 1));
  assert.equal(over.d, '');
  assert.equal(over.error, 'too-long');
});

test('the limit counts bytes, not characters: 778 three-byte characters are too long, 777 fit', () => {
  assert.equal(drawn('日'.repeat(777)).error, null);
  assert.equal(drawn('日'.repeat(778)).error, 'too-long');
});

test('a value that is too long keeps its accessible name and size', () => {
  const m = mount(h(QrCode, { value: 'a'.repeat(MAX_BYTES + 1), label: 'Invite link', size: 120 }));
  const svg = m.container.querySelector('svg')!;
  assert.equal(svg.getAttribute('aria-label'), 'Invite link');
  assert.equal(svg.getAttribute('width'), '120');
});
