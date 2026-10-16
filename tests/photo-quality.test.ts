import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { checkLabelQuality, enforceVerdict, preparePhoto } from '../src/lib/photo-quality';

export const labelSvg = `<svg width="1200" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1000" fill="white"/><g fill="black" font-family="sans-serif" font-size="44"><text x="90" y="140">SHELFIE TEST CLEANSER</text><text x="90" y="260">INGREDIENTS:</text><text x="90" y="380">Aqua, Glycerin, Cetyl Alcohol,</text><text x="90" y="480">Stearyl Alcohol, Sodium Chloride,</text><text x="90" y="580">Citric Acid, Phenoxyethanol.</text><text x="90" y="800">END OF INGREDIENT LIST</text></g></svg>`;
const verdict = (count = 1) => ({ sameProduct: true, completeIngredientList: true, certain: true, photos: Array.from({ length: count }, (_, index) => ({ index, blurry: false, dark: false, croppedText: false, glare: false, readable: true, confidence: 0.99 })) });

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

test('fail-closed verdict handles blur, darkness, cropping, glare, confidence and incomplete multi-photo coverage', () => {
  for (const field of ['blurry', 'dark', 'croppedText', 'glare'] as const) {
    const v = verdict(); v.photos[0][field] = true; assert.throws(() => enforceVerdict(v, 1));
  }
  for (const field of ['readable'] as const) { const v = verdict(); v.photos[0][field] = false; assert.throws(() => enforceVerdict(v, 1)); }
  for (const confidence of [0, 0.97, NaN, 2]) { const v = verdict(); v.photos[0].confidence = confidence; assert.throws(() => enforceVerdict(v, 1)); }
  for (const field of ['sameProduct', 'completeIngredientList', 'certain'] as const) { const v = verdict(2); v[field] = false; assert.throws(() => enforceVerdict(v, 2)); }
  for (const invalid of [null, {}, verdict(0), { ...verdict(), certain: 'true' }]) assert.throws(() => enforceVerdict(invalid, 1));
  const misordered = verdict(2); misordered.photos.reverse(); assert.throws(() => enforceVerdict(misordered, 2));
  assert.doesNotThrow(() => enforceVerdict(verdict(2), 2));
});

test('missing key, network failure, refusal and malformed provider output never accept; valid fixture checks all images', async () => {
  const before = process.env.LABEL_READER_API_KEY;
  const photo = await preparePhoto(await sharp(Buffer.from(labelSvg)).png().toBuffer());
  try {
    delete process.env.LABEL_READER_API_KEY;
    await assert.rejects(checkLabelQuality([photo]), /unavailable/);
    process.env.LABEL_READER_API_KEY = 'test-placeholder';
    await assert.rejects(checkLabelQuality([photo], async () => { throw new Error('offline'); }), /couldn’t confirm/);
    for (const content of ['bad-json', JSON.stringify({})]) {
      await assert.rejects(checkLabelQuality([photo], async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] })), /couldn’t confirm/);
    }
    await assert.rejects(checkLabelQuality([photo], async () => Response.json({ choices: [{ finish_reason: 'stop', message: { refusal: 'refused' } }] })), /couldn’t confirm/);
    await checkLabelQuality([photo, photo], async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.messages[1].content.filter((part: { type: string }) => part.type === 'image_url').length, 2);
      assert.equal(body.response_format.json_schema.strict, true);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(verdict(2)) } }] });
    });
  } finally { if (before === undefined) delete process.env.LABEL_READER_API_KEY; else process.env.LABEL_READER_API_KEY = before; }
});
