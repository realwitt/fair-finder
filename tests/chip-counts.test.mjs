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
  'hot dog': [53, 63], // also dropped false hits: Demitiri’s Original "(No Hot Dogs/Sausage)", Lee, Dennis "Coffee.(No Hot Dogs or Burgers)"
  'corn dog': [33, 49], // also dropped hot-dog-only related rows: Brinkley, Clark Lorene, Demitiri’s Original, Exchange Club Of New Hope/Wilders, Granny's Country Kitchen, Lee Dennis, Santillo Sausage, Steve's Dog House, Tim's Ole Time Hot Dogs, Zell's Italian Sausage
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
const negName = n => /Demitiri/.test(n) || /Lee, Dennis/.test(n);
const hotNames = direct('hot dog').map(h => h.booth.name);
ok(!hotNames.some(negName), 'negation booths excluded from hot dog');
ok(!cornNames.some(negName), 'negation booths excluded from corn dog');
// Related rows are score < 0.85 (the old hot-dog expansion). Slash menus like "Corn/hot Dogs" stay: they are real corn dogs.
const hotDogOnly = direct('corn dog').filter(h => h.score < 0.85);
ok(hotDogOnly.length === 0, 'corn dog has no hot-dog-only related rows ' + hotDogOnly.map(h => h.booth.name + ' ' + (h.matched || []).join('/')).join(' | '));
ok(FoodSearch.negationItems('(No Hot Dogs/Sausage)').join(',') === 'hot dog,sausage', 'slash negation parses hot dog and sausage');
ok(FoodSearch.negationItems('Coffee.(No Hot Dogs or Burgers)').join(',') === 'hot dog,burger', 'or negation parses hot dog and burger');
ok(FoodSearch.negationItems('no hot dog').join(',') === 'hot dog', 'lowercase no hot dog');
ok(FoodSearch.negationItems('No Hot Dogs').join(',') === 'hot dog', 'No Hot Dogs');
const coffeeLine = FoodSearch.prepare({ id: 'fake-c', name: 'C', products: '', items: ['Coffee.(No Hot Dogs or Burgers)'] });
ok(FoodSearch.match(coffeeLine, 'coffee', { allowFuzzy: false, synonymExpand: true }) && !FoodSearch.match(coffeeLine, 'hot dog', { allowFuzzy: false, synonymExpand: true }) && !FoodSearch.match(coffeeLine, 'burger', { allowFuzzy: false, synonymExpand: true }), 'negated phrase is not a match; the rest of the line still is');
const saidBoth = FoodSearch.prepare({ id: 'fake-both', name: 'Both', products: 'Hot dogs. (No Hot Dogs)', items: ['Hot dogs', '(No Hot Dogs)'] });
ok(!FoodSearch.match(saidBoth, 'hot dog', { allowFuzzy: false, synonymExpand: true }), 'a No hot dogs line excludes the booth from hot dog');
ok(direct('gyro').some(h => /Demitiri/.test(h.booth.name)) && direct('coffee').some(h => /Lee, Dennis/.test(h.booth.name)), 'negation booths stay in the foods they do sell');
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
