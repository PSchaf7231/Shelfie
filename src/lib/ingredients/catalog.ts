export const CATALOG_VERSION = '2026-10-10.2';
export const sources = {
  cosing: { title: 'European Commission CosIng ingredient-function reference', url: 'https://ec.europa.eu/growth/tools-databases/cosing/' },
  pregnancy: { title: 'American Academy of Dermatology: skin care during pregnancy', url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/routine/pregnancy' },
  pregnancyContext: { title: 'ACOG: skin conditions during pregnancy', url: 'https://www.acog.org/womens-health/faqs/skin-conditions-during-pregnancy' },
  fragrance: { title: 'FDA: fragrances in cosmetics', url: 'https://www.fda.gov/cosmetics/cosmetic-ingredients/fragrances-cosmetics' },
  acids: { title: 'FDA: alpha hydroxy acids', url: 'https://www.fda.gov/cosmetics/cosmetic-ingredients/alpha-hydroxy-acids' },
} as const;
export type SourceId = keyof typeof sources;
export type IngredientRecord = {
  name: string; aliases: string[]; explanation: string;
  alcohol: 'drying' | 'fatty' | null;
  role: 'moisturizer' | 'drying_alcohol' | 'other';
  pregnancy: 'retinoid' | 'hydroquinone' | 'salicylic' | null;
  sensitivity: 'fragrance' | 'exfoliating_acid' | 'retinoid' | null;
  sources: SourceId[];
};
function entry(name: string, explanation: string, aliases: string[] = [], options: Partial<Omit<IngredientRecord, 'name' | 'explanation' | 'aliases'>> = {}): IngredientRecord {
  return { name, aliases, explanation, alcohol: null, role: 'other', pregnancy: null, sensitivity: null, sources: ['cosing'], ...options };
}
const fatty = { alcohol: 'fatty', role: 'moisturizer' } as const;
const drying = { alcohol: 'drying', role: 'drying_alcohol' } as const;
const retinoid = { pregnancy: 'retinoid', sensitivity: 'retinoid', sources: ['cosing', 'pregnancy'] } as const;

// Exact names and documented aliases only. No fuzzy or substring matching.
// This deliberately finite catalog never manufactures a role for an unknown name.
export const catalog: IngredientRecord[] = [
  entry('Alcohol', 'A drying alcohol used to dissolve ingredients and make a formula dry quickly.', ['Ethanol', 'Ethyl Alcohol', 'SD Alcohol'], drying),
  entry('Alcohol Denat.', 'A drying alcohol with added substances that make it unsuitable for drinking.', ['Alcohol Denat', 'Denatured Alcohol', 'Denatured Ethanol', 'SD Alcohol 40', 'SD Alcohol 40-B', 'SD Alcohol 39-C'], drying),
  entry('Isopropyl Alcohol', 'A drying alcohol used to dissolve ingredients and help a formula dry quickly.', ['Isopropanol'], drying),
  entry('Cetyl Alcohol', 'A fatty alcohol that softens skin and helps moisturizers feel creamy.', [], fatty),
  entry('Cetearyl Alcohol', 'A blend of fatty alcohols that softens skin and gives moisturizers body.', ['Cetostearyl Alcohol'], fatty),
  entry('Stearyl Alcohol', 'A fatty alcohol that softens skin and thickens creamy moisturizers.', [], fatty),
  entry('Behenyl Alcohol', 'A fatty alcohol that softens skin and helps a cream hold its shape.', [], fatty),
  entry('Arachidyl Alcohol', 'A fatty alcohol used to soften skin and make creams thicker.', [], fatty),
  entry('Myristyl Alcohol', 'A fatty alcohol used to soften skin and give creams a smooth feel.', [], fatty),
  entry('Benzyl Alcohol', 'An ingredient used for scent or to help keep a product fresh; it is neither a drying nor a fatty alcohol.', [], { sensitivity: 'fragrance', sources: ['cosing', 'fragrance'] }),
  entry('Phenoxyethanol', 'An ingredient used to help keep a product fresh; its name does not make it drying ethanol.'),
  entry('Aqua', 'Water forms the base of many skincare products.', ['Water', 'Eau', 'Aqua (Water)', 'Water (Aqua)', 'Aqua/Water/Eau', 'Water/Aqua/Eau']),
  entry('Glycerin', 'An ingredient used to draw water into the skin’s outer layer.', ['Glycerine', 'Glycerol'], { role: 'moisturizer' }),
  entry('Sodium Hyaluronate', 'A form of hyaluronic acid used to hold water at the skin’s surface.', [], { role: 'moisturizer' }),
  entry('Hyaluronic Acid', 'An ingredient used to hold water at the skin’s surface.', [], { role: 'moisturizer' }),
  entry('Hydrolyzed Hyaluronic Acid', 'Smaller pieces of hyaluronic acid used to hold water near the skin’s surface.', [], { role: 'moisturizer' }),
  entry('Panthenol', 'An ingredient used to help the skin’s surface hold onto water.', ['Provitamin B5'], { role: 'moisturizer' }),
  entry('Betaine', 'An ingredient used to help the skin’s surface hold water.', [], { role: 'moisturizer' }),
  entry('Urea', 'An ingredient used to hold water and soften the skin’s outer layer.', [], { role: 'moisturizer' }),
  entry('Squalane', 'An oil-like ingredient used to soften skin and reduce moisture loss.', [], { role: 'moisturizer' }),
  entry('Squalene', 'An oil-like ingredient used to soften skin.', [], { role: 'moisturizer' }),
  entry('Petrolatum', 'An ingredient used to form a layer that slows water loss from skin.', ['Petroleum Jelly'], { role: 'moisturizer' }),
  entry('Paraffinum Liquidum', 'An oil used to soften skin and slow moisture loss.', ['Mineral Oil'], { role: 'moisturizer' }),
  entry('Dimethicone', 'An ingredient used to give skin a smooth feel and slow moisture loss.', [], { role: 'moisturizer' }),
  entry('Cyclopentasiloxane', 'An ingredient used to give a product a silky feel and help it spread.'),
  entry('Caprylic/Capric Triglyceride', 'An oil-like ingredient used to soften skin and help a product spread.', [], { role: 'moisturizer' }),
  entry('Butyrospermum Parkii Butter', 'Shea butter is used to soften skin and slow moisture loss.', ['Shea Butter', 'Butyrospermum Parkii (Shea) Butter'], { role: 'moisturizer' }),
  entry('Helianthus Annuus Seed Oil', 'Sunflower seed oil is used to soften skin.', ['Helianthus Annuus (Sunflower) Seed Oil', 'Sunflower Seed Oil'], { role: 'moisturizer' }),
  entry('Simmondsia Chinensis Seed Oil', 'Jojoba oil is used to give skin a soft, smooth feel.', ['Simmondsia Chinensis (Jojoba) Seed Oil', 'Jojoba Seed Oil'], { role: 'moisturizer' }),
  entry('Ceramide NP', 'A skin-like fat used in moisturizers to help limit water loss.', [], { role: 'moisturizer' }),
  entry('Ceramide AP', 'A skin-like fat used in moisturizers to help limit water loss.', [], { role: 'moisturizer' }),
  entry('Ceramide EOP', 'A skin-like fat used in moisturizers to help limit water loss.', [], { role: 'moisturizer' }),
  entry('Cholesterol', 'A skin-like fat used to give moisturizers body and help limit water loss.', [], { role: 'moisturizer' }),
  entry('Niacinamide', 'A form of vitamin B3 used in products aimed at supporting a smooth-looking skin surface.', ['Nicotinamide']),
  entry('Allantoin', 'An ingredient used to soften the skin’s surface.'),
  entry('Aloe Barbadensis Leaf Juice', 'Aloe leaf juice is used to add water and a soft feel to a formula.', ['Aloe Vera Leaf Juice']),
  entry('Avena Sativa Kernel Flour', 'Finely ground oat material used to give skin a soft feel.', ['Avena Sativa (Oat) Kernel Flour', 'Colloidal Oatmeal']),
  entry('Tocopherol', 'A form of vitamin E used in skincare and to help oils resist changes from air.'),
  entry('Tocopheryl Acetate', 'A form of vitamin E used to give skin a conditioned feel.'),
  entry('Ascorbic Acid', 'A form of vitamin C used in products aimed at a more even-looking complexion.', ['L-Ascorbic Acid']),
  entry('Sodium Ascorbyl Phosphate', 'A form of vitamin C used in products aimed at a more even-looking complexion.'),
  entry('Ascorbyl Glucoside', 'A form of vitamin C used in products aimed at a more even-looking complexion.'),
  entry('Retinol', 'A vitamin A family ingredient used in products aimed at smoother-looking skin.', [], { ...retinoid, sources: [...retinoid.sources] }),
  entry('Retinal', 'A vitamin A family ingredient used in products aimed at smoother-looking skin.', ['Retinaldehyde'], { ...retinoid, sources: [...retinoid.sources] }),
  ...['Retinyl Palmitate', 'Retinyl Acetate', 'Retinyl Propionate', 'Retinyl Linoleate', 'Hydroxypinacolone Retinoate', 'Adapalene', 'Tazarotene', 'Isotretinoin'].map(name => entry(name, 'A vitamin A family ingredient used in products aimed at smoother-looking skin.', [], { ...retinoid, sources: [...retinoid.sources] })),
  entry('Tretinoin', 'A vitamin A family ingredient used in products aimed at smoother-looking skin.', ['Retinoic Acid', 'All-Trans Retinoic Acid'], { ...retinoid, sources: [...retinoid.sources] }),
  entry('Hydroquinone', 'An ingredient used in products aimed at a more even-looking skin tone.', [], { pregnancy: 'hydroquinone', sources: ['cosing', 'pregnancy'] }),
  entry('Salicylic Acid', 'An acid used to loosen buildup on the skin’s surface.', [], { pregnancy: 'salicylic', sensitivity: 'exfoliating_acid', sources: ['cosing', 'pregnancy', 'pregnancyContext'] }),
  entry('Glycolic Acid', 'An acid used to loosen the skin’s outermost buildup.', [], { sensitivity: 'exfoliating_acid', sources: ['cosing', 'acids'] }),
  entry('Lactic Acid', 'An acid used to loosen surface buildup or adjust a product’s acidity.', [], { sensitivity: 'exfoliating_acid', sources: ['cosing', 'acids'] }),
  entry('Mandelic Acid', 'An acid used to loosen buildup on the skin’s surface.', [], { sensitivity: 'exfoliating_acid', sources: ['cosing', 'acids'] }),
  entry('Citric Acid', 'An ingredient often used to adjust how acidic a product is.'),
  entry('Gluconolactone', 'An ingredient used to loosen surface buildup or help a formula hold water.'),
  entry('Azelaic Acid', 'An ingredient used in products aimed at a more even-looking skin surface.'),
  entry('Bakuchiol', 'A plant-derived ingredient used in products aimed at smoother-looking skin; it is not a retinoid.'),
  entry('Parfum', 'A blend of ingredients added to give the product a scent.', ['Fragrance', 'Perfume', 'Parfum (Fragrance)', 'Fragrance (Parfum)'], { sensitivity: 'fragrance', sources: ['cosing', 'fragrance'] }),
  ...['Limonene', 'Linalool', 'Citral', 'Geraniol', 'Eugenol', 'Citronellol', 'Hexyl Cinnamal', 'Coumarin'].map(name => entry(name, 'A scent ingredient that can feel irritating on sensitive skin.', [], { sensitivity: 'fragrance', sources: ['cosing', 'fragrance'] })),
  entry('Lavandula Angustifolia Oil', 'Lavender oil is added for scent and can feel irritating on sensitive skin.', ['Lavandula Angustifolia (Lavender) Oil', 'Lavender Oil'], { sensitivity: 'fragrance', sources: ['cosing', 'fragrance'] }),
  entry('Mentha Piperita Oil', 'Peppermint oil is added for scent and a cooling feel that some skin finds irritating.', ['Mentha Piperita (Peppermint) Oil', 'Peppermint Oil'], { sensitivity: 'fragrance', sources: ['cosing', 'fragrance'] }),
  entry('Disodium EDTA', 'An ingredient used to help a formula stay consistent when minerals are present.'),
  entry('Carbomer', 'An ingredient used to thicken a gel or cream.'),
  entry('Xanthan Gum', 'An ingredient used to thicken a formula and keep it evenly mixed.'),
  entry('Sodium Chloride', 'Salt can help adjust how thick a formula feels.'),
  entry('Sodium Hydroxide', 'An ingredient used in small amounts to adjust a product’s acidity.'),
  entry('Triethanolamine', 'An ingredient used to adjust acidity or help oils and water stay mixed.'),
  entry('Sodium Benzoate', 'An ingredient used to help keep a product fresh.'),
  entry('Potassium Sorbate', 'An ingredient used to help keep a product fresh.'),
  entry('Ethylhexylglycerin', 'An ingredient used to support a product’s freshness and give skin a soft feel.'),
  entry('1,2-Hexanediol', 'An ingredient used to hold water and support a product’s freshness.'),
  entry('Butylene Glycol', 'An ingredient used to hold water and help other ingredients dissolve.'),
  entry('Propylene Glycol', 'An ingredient used to hold water and help other ingredients dissolve.'),
  entry('Propanediol', 'An ingredient used to hold water and help other ingredients dissolve.'),
  entry('Pentylene Glycol', 'An ingredient used to hold water and help other ingredients dissolve.'),
  entry('Glyceryl Stearate', 'An ingredient used to soften skin and help oils and water stay mixed.'),
  entry('PEG-100 Stearate', 'An ingredient used to help oils and water stay mixed.'),
  entry('Polysorbate 20', 'An ingredient used to help oils spread evenly through a water-based formula.'),
  entry('Cocamidopropyl Betaine', 'An ingredient used to help water lift oils and dirt from the skin’s surface.'),
  entry('Sodium Cocoyl Isethionate', 'An ingredient used to help water lift oils and dirt from the skin’s surface.'),
  entry('Sodium Laureth Sulfate', 'An ingredient used to lift oils and dirt and make a cleanser foam.'),
  entry('Sodium Lauryl Sulfate', 'An ingredient used to lift oils and dirt and make a cleanser foam.'),
  entry('Decyl Glucoside', 'An ingredient used to help water lift oils and dirt from the skin’s surface.'),
  entry('Zinc Oxide', 'A mineral used in some sunscreens and to make formulas less see-through.'),
  entry('Titanium Dioxide', 'A mineral used in some sunscreens or to give a formula a pale color.', ['CI 77891']),
];

export function normalizeName(name: string) { return name.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/\.$/, '').toLowerCase(); }
const index = new Map<string, IngredientRecord>();
for (const record of catalog) for (const name of [record.name, ...record.aliases]) {
  const key = normalizeName(name);
  const existing = index.get(key);
  if (existing && existing !== record) throw new Error(`Ambiguous ingredient alias: ${name}`);
  index.set(key, record);
}
export function findIngredient(name: string) { return index.get(normalizeName(name)) ?? null; }
