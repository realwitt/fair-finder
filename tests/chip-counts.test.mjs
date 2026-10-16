// Food-chip direct counts vs v7.3.1 (4338d6e). Node only.
// v7.5 turned synonym expansion off for every exact concept term, which cut the chips.
// Chips expand synonyms again. Edit distance stays off for exact terms, so slushie does
// not land on sushi/plush. A multi-word phrase has to hit one menu item, so "corn" and
// "dog" in different dishes do not combine.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const FoodSearch = require('../search.js');
const Concepts = require('../concepts.js');
const Stats = require('../stats.js');
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const read = f => JSON.parse(fs.readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const syn = read('synonyms.json');
const booths = read('booths.json').booths.filter(b => b.lat != null).map(FoodSearch.prepare);
const C = Concepts.create(syn);
function direct(q) {
  const exact = C.exactTerm(q);
  const chip = !!Stats.chipKey(q);
  return FoodSearch.search(booths, q, { allowFuzzy: !exact, synonymExpand: !exact || chip });
}
// Floors are the v7.3.1 counts minus booths that only matched by edit distance or by
// joining words from different dishes. Ceilings are the v7.3.1 counts.
const RANGE = {
  'hot dog': [55, 63], // dropped: Borgil, Leaf Massage x2, SBI x2, Prince Group, Royer's (sausage~massage / arson dog), OMC churro dog
  'corn dog': [43, 49], // dropped: SBI x2 (arson dog), Spiffy Duds x2 (bandanas), Veronica's dog treats, OMC churro dog + corn bowl
  'funnel cake': [19, 19],
  'ice cream': [19, 22], // dropped: Hot Chix (whipped cream), Pretzel Lady (mustard pretzels), Pickle Bun (ice pop + cream cheese)
  'bbq': [34, 36], // dropped: Serenity (baskets~barbecue), Kreyol Flavor (oxtail "pulled", not a barbecue stand)
  'turkey leg': [10, 10],
  'lemonade': [68, 68],
  'empanada': [3, 3],
  'fried cheeseburger': [2, 2],
};
for (const q of Object.keys(RANGE)) {
  const n = direct(q).length;
  const [lo, hi] = RANGE[q];
  ok(n >= lo && n <= hi, q + ' direct ' + n + ' in ' + lo + '..' + hi);
}
const sl = direct('slushie');
const slText = sl.map(h => h.booth.name + ' ' + (h.matched || []).join(' ')).join(' | ');
ok(sl.length === 1, 'slushie stays one direct hit ' + slText);
ok(!/Korean Sushi|Plushipop/i.test(slText), 'slushie excludes Korean Sushi Rolls and Plushipop ' + slText);
const corn = direct('corn dog');
const cornNames = corn.map(h => h.booth.name);
ok(!cornNames.includes('OMC! Oh My Churro'), 'corn dog excludes OMC! Oh My Churro');
const pita = corn.find(h => h.booth.name === 'Party In A Pita');
// The menu lists a real "Corndog" line, so the booth stays. The hot-dog taco must not be what qualifies it.
ok(pita && pita.matched.some(m => /corndog/i.test(m)), 'Party In A Pita is in corn dog because the menu says Corndog ' + (pita && pita.matched.join(' / ')));
const split = FoodSearch.prepare({
  id: 'fake-split', name: 'Split Stand', kind: 'vendor', products: '',
  // No single item is a corn dog or a related phrase (hot dog / kdog). "corn" and "dog" sit in different dishes.
  items: ['Dog Taco', 'corn bowl', 'Monster churro dog'],
});
ok(!FoodSearch.match(split, 'corn dog', { allowFuzzy: false, synonymExpand: true }), 'corn and dog in different items do not match');
ok(!cornNames.includes('OMC! Oh My Churro') && !direct('corn dog').some(h => /Party In A Pita/.test(h.booth.name) && h.matched.every(m => /taco/i.test(m))), 'corn dog does not keep a taco-only hit');
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
