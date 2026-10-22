export function estimateColorCoverage(data: Uint8ClampedArray) {
  let inkPixels = 0;
  let chromaticPixels = 0;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    if (Math.min(red, green, blue) < 238) inkPixels += 1;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 34) chromaticPixels += 1;
  }
  return inkPixels === 0 ? 0 : chromaticPixels / inkPixels;
}
