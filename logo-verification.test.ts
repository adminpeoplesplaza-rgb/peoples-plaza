import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const HTML_FILES = [
  'index.html',
  'admin.html',
  'portal.html',
  'login.html',
  'admin-login.html',
  'forgot-password.html',
  'reset-password.html',
];

test('transparent PNG logo exists in root and public with RGBA color type and transparent background', () => {
  for (const relPath of ['peoples-plaza-logo.png', 'public/peoples-plaza-logo.png']) {
    const fullPath = path.resolve(process.cwd(), relPath);
    assert.equal(fs.existsSync(fullPath), true, `${relPath} should exist`);
    const buf = fs.readFileSync(fullPath);
    // Check PNG signature
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const bitDepth = buf.readUInt8(24);
    const colorType = buf.readUInt8(25);
    assert.ok(width > 300 && height > 300, 'Logo dimensions should be high-resolution');
    assert.equal(bitDepth, 8);
    assert.equal(colorType, 6, 'PNG must be RGBA (colorType 6) with alpha channel');

    // Decompress IDAT to verify corner transparency and non-transparent interior
    let offset = 8;
    const idatChunks: Buffer[] = [];
    while (offset < buf.length) {
      const len = buf.readUInt32BE(offset);
      const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
      if (type === 'IDAT') {
        idatChunks.push(buf.subarray(offset + 8, offset + 8 + len));
      }
      offset += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idatChunks));
    // First pixel (top-left corner) at byte 1..4 (after filter byte 0)
    assert.equal(raw[4], 0, 'Top-left corner pixel alpha must be 0 (fully transparent)');
  }
});

test('all 7 HTML pages use /peoples-plaza-logo.png and have no old /logo-neon-icon.png references', () => {
  for (const file of HTML_FILES) {
    const content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.equal(
      content.includes('logo-neon-icon'),
      false,
      `${file} should not reference old logo-neon-icon`
    );
    assert.equal(
      content.includes('/peoples-plaza-logo.png'),
      true,
      `${file} must reference /peoples-plaza-logo.png`
    );
    assert.equal(
      content.includes('alt="People\'s Plaza Logo"'),
      true,
      `${file} must include accessible alt="People's Plaza Logo"`
    );
  }
});

test('homepage header replaces text logo and applies ~2cm left alignment only to homepage header', () => {
  const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  assert.equal(indexHtml.includes('id="site-brand-title"'), false, 'Old brand title text element removed from index.html header');
  assert.equal(indexHtml.includes('id="site-brand-subtitle"'), false, 'Old brand subtitle text element removed from index.html header');
  assert.equal(indexHtml.includes('pp-header-logo-link'), true, 'Homepage header uses pp-header-logo-link');
  assert.equal(indexHtml.includes('pp-header-logo-img'), true, 'Homepage header uses pp-header-logo-img');

  const stylesCss = fs.readFileSync(path.resolve(process.cwd(), 'styles.css'), 'utf8');
  assert.equal(stylesCss.includes('margin-left: 2cm;'), true, 'styles.css defines 2cm left margin on desktop');
  assert.equal(stylesCss.includes('object-fit: contain;'), true, 'styles.css preserves aspect ratio via object-fit: contain');
});
