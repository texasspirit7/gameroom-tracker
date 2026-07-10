import sharp from 'sharp';

// Anthropic downscales images whose longest edge exceeds this before the model
// ever sees them. For a dense, small-print table (e.g. 65 machine rows), letting
// that happen via whatever generic resize their pipeline applies can blur the
// per-row digits into illegibility while big, bold summary numbers stay fine —
// which matches exactly what we've seen: totals/expenses extract correctly,
// the machine table doesn't. Doing our own high-quality resize + sharpen here
// means we control that quality tradeoff instead of leaving it to chance.
const MAX_EDGE = 1568;

/**
 * Prepares an uploaded photo for Claude vision: downscales oversized images
 * with a high-quality filter (never upscales — that fabricates detail that
 * was never captured), sharpens to counter resize softening, and normalizes
 * contrast to help faint printed digits stand out. Always outputs PNG so we
 * never add new lossy-compression artifacts on top of the original.
 */
export async function preprocessImageForVision(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const longEdge = Math.max(metadata.width || 0, metadata.height || 0);

  let pipeline = image;
  const resized = longEdge > MAX_EDGE;
  if (resized) {
    pipeline = pipeline.resize({
      width: metadata.width >= metadata.height ? MAX_EDGE : null,
      height: metadata.height > metadata.width ? MAX_EDGE : null,
      fit: 'inside',
      kernel: sharp.kernel.lanczos3,
    });
  }

  const outputBuffer = await pipeline.sharpen().normalize().png().toBuffer();
  const outputMeta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    mediaType: 'image/png',
    width: outputMeta.width,
    height: outputMeta.height,
    resized,
  };
}
