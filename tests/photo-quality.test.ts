import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { preparePhoto } from '../src/lib/photo-quality';

export const labelSvg = `<svg width="1200" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1000" fill="white"/><g fill="black" font-family="sans-serif" font-size="44"><text x="90" y="140">SHELFIE TEST CLEANSER</text><text x="90" y="260">INGREDIENTS:</text><text x="90" y="380">Aqua, Glycerin, Cetyl Alcohol,</text><text x="90" y="480">Stearyl Alcohol, Sodium Chloride,</text><text x="90" y="580">Citric Acid, Phenoxyethanol.</text><text x="90" y="800">END OF INGREDIENT LIST</text></g></svg>`;
test('decodes a detailed image, strips metadata and rejects real dark, blurred and invalid inputs', async () => {
  const source = await sharp(Buffer.from(labelSvg)).png().toBuffer();
  const result = await preparePhoto(source);
  assert.equal((await sharp(result.bytes).metadata()).format, 'jpeg');
  assert.equal((await sharp(result.bytes).metadata()).exif, undefined);
  const dark = await sharp(source).modulate({ brightness: 0.04 }).png().toBuffer();
  await assert.rejects(preparePhoto(dark), /dark/);
  const blurry = await sharp(source).blur(35).png().toBuffer();
  await assert.rejects(preparePhoto(blurry), /blurry/);
  await assert.rejects(preparePhoto(Buffer.from('not an image')), /couldn’t open/);
  await assert.rejects(preparePhoto(await sharp(source).resize(200).png().toBuffer()), /resolution/);
  await assert.rejects(preparePhoto(Buffer.alloc(6 * 1024 * 1024 + 1)), /6 MB/);
});
