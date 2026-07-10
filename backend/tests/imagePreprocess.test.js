import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { preprocessImageForVision } from '../extract/imagePreprocess.js';

function makeImage(width, height) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .jpeg()
    .toBuffer();
}

describe('preprocessImageForVision', () => {
  test('downscales an oversized landscape image to a 1568px long edge, preserving aspect ratio', async () => {
    const buf = await makeImage(3000, 2000);
    const result = await preprocessImageForVision(buf);
    assert.equal(result.resized, true);
    assert.equal(result.width, 1568);
    assert.equal(result.height, Math.round((2000 / 3000) * 1568));
    assert.equal(result.mediaType, 'image/png');
  });

  test('downscales an oversized portrait image to a 1568px long edge on height', async () => {
    const buf = await makeImage(1000, 3000);
    const result = await preprocessImageForVision(buf);
    assert.equal(result.resized, true);
    assert.equal(result.height, 1568);
    assert.equal(result.width, Math.round((1000 / 3000) * 1568));
  });

  test('never upscales an already-small image', async () => {
    const buf = await makeImage(500, 400);
    const result = await preprocessImageForVision(buf);
    assert.equal(result.resized, false);
    assert.equal(result.width, 500);
    assert.equal(result.height, 400);
  });

  test('an image exactly at the max edge is left unresized', async () => {
    const buf = await makeImage(1568, 1000);
    const result = await preprocessImageForVision(buf);
    assert.equal(result.resized, false);
    assert.equal(result.width, 1568);
  });

  test('output is always a valid, decodable PNG regardless of input format', async () => {
    const buf = await makeImage(800, 600);
    const result = await preprocessImageForVision(buf);
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.format, 'png');
  });
});
