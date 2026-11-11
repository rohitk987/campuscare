/**
 * CampusCare algorithms: evidence-aware complaint triage.
 *
 * Pure, dependency-free functions shared by the Worker (server-side analysis),
 * the browser (live suggestions, the Insights lab) and the Node evaluation script.
 * Nothing here reads the database or trusts identity; callers pass data the viewer
 * is already authorised to see.
 *
 *  1. Text: tokenisation, light stemming, TF-IDF vectors, cosine similarity
 *  2. Multinomial Naive Bayes category classifier (Laplace smoothing), with evidence
 *  3. Duplicate detection: place × time gated score, modulated by wording, boosted by a like photo
 *  4. Perceptual photo hash (dHash, 64-bit) and Hamming distance
 *  5. Beta reputation for reporter credibility (Jøsang & Ismail, 2002)
 *  6. Explainable multi-factor priority score
 *  7. Workload-aware technician assignment: Hungarian algorithm with capacity slots
 *  8. ST-DBSCAN spatio-temporal hotspot clustering (Birant & Kut, 2007), and the space-time
 *     permutation scan statistic for significance (Kulldorff et al., 2005)
 *  9. Weekly trend series and leave-one-out classifier evaluation
 */

const DAY = 86_400_000;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/* ------------------------------------------------------------------ 1. Text */

const STOP = new Set(('a an the and or but of to in on at for with from by is are was were be been being it its this that these those there here near not no very too also into over under as if then than so we i you he she they them our my your their has have had do does did can could will would should may might just still only about after before when while which who what where why how all any some more most less other such own same up down out off again once both each few please since today yesterday morning evening last first second third one two three side room floor block near next its it\'s im dont doesnt cant').split(' '));

/** Light suffix stemmer: enough to join leak/leaking/leaked/leaks, never a full Porter stemmer. */
export function stem(word: string): string {
 if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
 if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
 if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
 if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
 return word;
}

export function tokenize(text: string): string[] {
 return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  .filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);
}

export type SparseVector = Map<string, number>;

/** Smoothed inverse document frequency: idf(t) = ln((N + 1) / (df(t) + 1)) + 1. */
export function inverseDocumentFrequency(documents: string[][]): Map<string, number> {
 const df = new Map<string, number>();
 for (const doc of documents) for (const term of new Set(doc)) df.set(term, (df.get(term) || 0) + 1);
 const idf = new Map<string, number>(), n = documents.length;
 for (const [term, count] of df) idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
 return idf;
}

/** L2-normalised TF-IDF vector; unseen terms take the maximum idf (rarest). */
export function tfidf(tokens: string[], idf: Map<string, number>): SparseVector {
 const tf = new Map<string, number>(), rare = Math.max(1, ...idf.values());
 for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
 let norm = 0;
 for (const [t, c] of tf) { const w = c * (idf.get(t) ?? rare); tf.set(t, w); norm += w * w; }
 norm = Math.sqrt(norm) || 1;
 for (const [t, w] of tf) tf.set(t, w / norm);
 return tf;
}

export function cosine(a: SparseVector, b: SparseVector): number {
 let dot = 0; const [small, large] = a.size < b.size ? [a, b] : [b, a];
 for (const [t, w] of small) { const v = large.get(t); if (v) dot += w * v; }
 return clamp01(dot);
}

/* ------------------------------------------------- 2. Naive Bayes classifier */

export type LabelledText = { text: string; label: string };
export type NaiveBayesModel = {
 classes: string[]; alpha: number; vocabulary: string[];
 documents: Record<string, number>; tokens: Record<string, number>;
 counts: Record<string, Record<string, number>>; total: number;
};
export type Prediction = { label: string; probability: number };
export type ClassifierResult = { predictions: Prediction[]; evidence: { term: string; word: string; weight: number }[] };

/** Map each stem back to the first word in the text that produced it, for display. */
function surfaceWords(text: string) {
 const map = new Map<string, string>();
 for (const w of text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) if (w && !map.has(stem(w))) map.set(stem(w), w);
 return map;
}

/**
 * Domain lexicon: words a maintenance desk associates with each category. Used as pseudo-counts
 * (lexicon-augmented Naive Bayes), so short complaints classify well before the campus has history.
 */
export const CATEGORY_LEXICON: Record<string, string> = {
 Electrical: 'fan light bulb tube switch socket plug wire wiring power electric electricity mcb fuse spark shock voltage regulator panel current bulb led tripping',
 Plumbing: 'tap leak leaking pipe drain flush toilet washroom bathroom sink basin shower urinal clog blocked choked overflow sewage commode valve',
 Furniture: 'chair desk table bench cupboard wardrobe door hinge drawer bed shelf rack leg backrest seat wood broken furniture locker',
 'Classroom technology': 'projector screen hdmi cable computer pc laptop speaker microphone mic audio smart board wifi network internet printer display signal',
 'Drinking water': 'drinking cooler purifier ro dispenser filter bottle potable taste dirty cold water',
 Appliances: 'ac air conditioner refrigerator fridge microwave geyser heater washing machine exhaust oven stove induction cooling',
 Lifts: 'lift elevator stuck floor door button cabin alarm jerk',
 'Gym equipment': 'gym treadmill dumbbell weights bench press cycle rowing pulley machine plate pull bar exercise',
 Other: 'garbage dustbin paint wall tile glass window gate lock sign notice pigeon dog cleaning broom',
};

/**
 * Train a multinomial Naive Bayes model: one counting pass, O(total tokens).
 * Each lexicon word adds `lexiconWeight` pseudo-occurrences to its category.
 */
export function trainNaiveBayes(examples: LabelledText[], alpha = 1, lexicon: Record<string, string> | null = CATEGORY_LEXICON, lexiconWeight = 2): NaiveBayesModel {
 const documents: Record<string, number> = {}, tokens: Record<string, number> = {}, counts: Record<string, Record<string, number>> = {}, vocab = new Set<string>();
 const add = (label: string, term: string, n: number) => { const bag = counts[label] || (counts[label] = {}); bag[term] = (bag[term] || 0) + n; tokens[label] = (tokens[label] || 0) + n; vocab.add(term); };
 for (const { text, label } of examples) {
  documents[label] = (documents[label] || 0) + 1;
  for (const t of tokenize(text)) add(label, t, 1);
 }
 if (lexicon) for (const [label, words] of Object.entries(lexicon)) if (documents[label]) for (const t of tokenize(words)) add(label, t, lexiconWeight);
 return { classes: Object.keys(documents).sort(), alpha, vocabulary: [...vocab].sort(), documents, tokens, counts, total: examples.length };
}

function logLikelihood(model: NaiveBayesModel, label: string, term: string) {
 const v = model.vocabulary.length || 1;
 return Math.log(((model.counts[label]?.[term] || 0) + model.alpha) / ((model.tokens[label] || 0) + model.alpha * v));
}

/**
 * Posterior P(c | d) ∝ P(c) · Π P(w | c)^n(w,d), computed in log space and normalised with
 * log-sum-exp. Evidence lists the terms that most favour the winning class over the runner-up:
 * weight(w) = log P(w | c1) − log P(w | c2).
 */
export function predictNaiveBayes(model: NaiveBayesModel, text: string): ClassifierResult {
 const terms = tokenize(text).filter(t => model.vocabulary.length === 0 || model.counts && model.vocabulary.includes(t));
 if (!model.total) return { predictions: [], evidence: [] };
 const scores = model.classes.map(c => {
  let s = Math.log(model.documents[c] / model.total);
  for (const t of terms) s += logLikelihood(model, c, t);
  return { label: c, s };
 });
 const max = Math.max(...scores.map(x => x.s)), z = scores.reduce((acc, x) => acc + Math.exp(x.s - max), 0);
 const predictions = scores.map(x => ({ label: x.label, probability: Math.exp(x.s - max) / z })).sort((a, b) => b.probability - a.probability);
 const [first, second] = predictions, words = surfaceWords(text);
 const evidence = !first || !second ? [] : [...new Set(terms)]
  .map(term => ({ term, word: words.get(term) || term, weight: logLikelihood(model, first.label, term) - logLikelihood(model, second.label, term) }))
  .filter(e => e.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 5);
 return { predictions, evidence };
}

/** Leave-one-out evaluation: accuracy, macro F1 and a confusion matrix. O(n · train). */
export function evaluateClassifier(examples: LabelledText[], alpha = 1, lexicon: Record<string, string> | null = CATEGORY_LEXICON) {
 const labels = [...new Set(examples.map(e => e.label))].sort();
 const confusion: Record<string, Record<string, number>> = {};
 for (const a of labels) { confusion[a] = {}; for (const b of labels) confusion[a][b] = 0; }
 let correct = 0;
 examples.forEach((example, i) => {
  const model = trainNaiveBayes(examples.filter((_, j) => j !== i), alpha, lexicon);
  const guess = predictNaiveBayes(model, example.text).predictions[0]?.label || labels[0];
  confusion[example.label][guess] = (confusion[example.label][guess] || 0) + 1;
  if (guess === example.label) correct++;
 });
 const perClass = labels.map(label => {
  const tp = confusion[label][label], fp = labels.reduce((s, other) => s + (other === label ? 0 : confusion[other][label]), 0), fn = labels.reduce((s, other) => s + (other === label ? 0 : confusion[label][other]), 0);
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  return { label, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, support: tp + fn };
 });
 return { accuracy: examples.length ? correct / examples.length : 0, macroF1: perClass.reduce((s, c) => s + c.f1, 0) / (perClass.length || 1), perClass, confusion, labels };
}

/** Hand-written seed examples so suggestions work before the campus has history. */
export const SEED_CORPUS: LabelledText[] = [
 ...['Ceiling fan not working in classroom', 'Tube light flickering above the board', 'Switch board sparking when plugged in', 'Power socket has no electricity', 'Exposed wire hanging from the wall', 'Light bulb fused in corridor', 'MCB keeps tripping in the lab', 'Fan regulator broken and fan runs at full speed', 'No power in the hostel room since morning', 'Burning smell from the electrical panel'].map(text => ({ text, label: 'Electrical' })),
 ...['Tap leaking continuously in washroom', 'Toilet flush not working', 'Water overflowing from the sink drain', 'Blocked drain in the bathroom floor', 'Pipe burst under the basin', 'Shower has no water pressure', 'Urinal is clogged and smells', 'Water dripping from the ceiling pipe', 'Tap will not close fully', 'Wash basin drain is choked'].map(text => ({ text, label: 'Plumbing' })),
 ...['Broken chair in the classroom', 'Desk leg is loose and wobbles', 'Bench seat cracked', 'Cupboard door hinge broken', 'Table top has a sharp broken edge', 'Chair backrest came off', 'Door handle of the wardrobe fell off', 'Bed frame in hostel room is broken', 'Window curtain rod has fallen', 'Drawer will not open on the desk'].map(text => ({ text, label: 'Furniture' })),
 ...['Projector shows no signal', 'Smart board not responding to touch', 'Speaker system in seminar hall not working', 'Classroom computer will not boot', 'HDMI cable for projector is broken', 'Microphone has no sound in auditorium', 'Projector display is blurry and dim', 'Lab PC keyboard missing keys', 'Wifi access point in classroom is down', 'Document camera not detected'].map(text => ({ text, label: 'Classroom technology' })),
 ...['Water cooler not cooling', 'Drinking water tastes bad', 'RO purifier leaking water', 'Water dispenser empty for two days', 'Cooler tap broken at the corridor', 'Water purifier showing error light', 'Drinking water has dirt particles', 'Filter of the water cooler needs replacement', 'No drinking water on the second floor', 'Water cooler leaking onto the floor'].map(text => ({ text, label: 'Drinking water' })),
 ...['Refrigerator in the pantry not cooling', 'Microwave sparks when switched on', 'Air conditioner not cooling the lab', 'AC remote missing and unit stuck on', 'Geyser not heating water in hostel', 'Washing machine drum not spinning', 'Exhaust fan making loud noise', 'Water heater leaking', 'Induction stove in mess not heating', 'AC dripping water inside the room'].map(text => ({ text, label: 'Appliances' })),
 ...['Lift stuck between floors', 'Elevator door does not close', 'Lift buttons not responding', 'Lift making grinding noise while moving', 'Elevator stops at wrong floor', 'Lift light and fan not working inside', 'Elevator alarm button not working', 'Lift jerks when starting', 'Lift door sensor faulty and door closes on people', 'Elevator out of service sign for a week'].map(text => ({ text, label: 'Lifts' })),
 ...['Treadmill belt slipping', 'Dumbbell rack broken in gym', 'Exercise cycle pedal came off', 'Bench press cushion torn', 'Cable machine pulley jammed', 'Gym mirror cracked', 'Rowing machine seat stuck', 'Weight plates missing from the rack', 'Treadmill display not turning on', 'Pull up bar is loose on the wall'].map(text => ({ text, label: 'Gym equipment' })),
 ...['Garbage not collected near the canteen', 'Notice board glass broken', 'Pigeons nesting in the corridor', 'Wall paint peeling in classroom', 'Main gate lock broken', 'Signboard has fallen down', 'Window glass cracked in the library', 'Corridor floor tiles broken', 'Dustbin missing on the floor', 'Stray dog inside the hostel block'].map(text => ({ text, label: 'Other' })),
];

/* ------------------------------------------------- 3. Duplicate detection */

export type ReportLike = {
 id: string; title: string; item?: string; description?: string; category: string;
 locationId: string; buildingId?: string | null; createdAt: number;
 latitude?: number | null; longitude?: number | null; photoHash?: string | null;
};
export type DuplicateParams = { metres: number; days: number; textFloor: number; photoBoost: number; categoryMismatch: number; sameBuilding: number };
/**
 * Scales and photo boost chosen on a simulated training term and checked on a separate test term
 * (scripts/evaluate-algorithms.mjs). The simulation could not separate text floors of 0.4 and 0.5, so the
 * floor follows a stated rule: two reports in different categories with no word in common are never a
 * match on place and time alone (categoryMismatch × textFloor = 0.3 < DUPLICATE_THRESHOLD).
 */
export const DUPLICATE: DuplicateParams = { metres: 25, days: 10, textFloor: 0.4, photoBoost: 0.25, categoryMismatch: 0.75, sameBuilding: 0.4 };
/** Above the simulated training term's F1-best threshold (0.30) by a margin, so categoryMismatch × textFloor = 0.30 never reaches it. */
export const DUPLICATE_THRESHOLD = 0.35;
export type DuplicateMatch = { id: string; score: number; parts: { text: number; space: number; time: number; photo: number | null; category: number } };

export function reportText(r: Pick<ReportLike, 'title' | 'item' | 'description'>) { return `${r.title} ${r.item || ''} ${r.description || ''}`; }

/** Great-circle distance in metres (haversine). */
export function haversine(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
 const rad = Math.PI / 180, p = (b.latitude - a.latitude) * rad, q = (b.longitude - a.longitude) * rad;
 const h = Math.sin(p / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(q / 2) ** 2;
 return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/** How close two reports were filed: 1 same room; else exp(−d / λ) between capture points; else a flat value for the same building. */
export function placeSimilarity(a: ReportLike, b: ReportLike, p: DuplicateParams = DUPLICATE) {
 if (a.locationId === b.locationId) return 1;
 if (a.latitude != null && a.longitude != null && b.latitude != null && b.longitude != null) return Math.exp(-haversine(a as { latitude: number; longitude: number }, b as { latitude: number; longitude: number }) / p.metres);
 return a.buildingId && a.buildingId === b.buildingId ? p.sameBuilding : 0;
}

/**
 * S(a, b) = c · s_place · s_time · (f + (1 − f) · s_text), and when the photos are alike
 * S ← S + (1 − S) · β · s_photo, where
 *  s_place = 1 same room, else exp(−d / 25 m) between capture points, else 0.4 same building, else 0
 *  s_time  = exp(−|Δt| / 10 days)
 *  s_text  = cos(tfidf(a), tfidf(b)), floored by f = 0.4
 *  s_photo = clamp((1 − H(a, b)/64 − 0.6) / 0.4), H = Hamming distance of 64-bit dHashes; β = 0.25
 *  c       = 1 when categories agree, otherwise 0.75
 * Place and time multiply because one incident needs both: the same room a month later is a new fault,
 * and the same week in another building is too. Wording only separates faults inside that window, and
 * paraphrases share few words, so it scales the score instead of vetoing it. The photo is one-sided
 * evidence: two people photograph one fault from different angles, so unlike pictures prove nothing.
 * An earlier weighted average of the four signals let shared wording outvote place and time and lost
 * to the plain same-room rule; docs/ALGORITHMS-EVALUATION.md has both.
 */
export function duplicateScore(a: ReportLike, b: ReportLike, idf: Map<string, number>, p: DuplicateParams = DUPLICATE): DuplicateMatch {
 return scorePair(a, b, tfidf(tokenize(reportText(a)), idf), tfidf(tokenize(reportText(b)), idf), p);
}
function scorePair(a: ReportLike, b: ReportLike, va: Map<string, number>, vb: Map<string, number>, p: DuplicateParams): DuplicateMatch {
 const text = cosine(va, vb);
 const space = placeSimilarity(a, b, p);
 const time = Math.exp(-Math.abs(a.createdAt - b.createdAt) / (p.days * DAY));
 const photo = a.photoHash && b.photoHash ? clamp01((1 - hamming(a.photoHash, b.photoHash) / 64 - 0.6) / 0.4) : null;
 const category = a.category === b.category ? 1 : p.categoryMismatch;
 let score = category * space * time * (p.textFloor + (1 - p.textFloor) * text);
 if (photo) score += (1 - score) * p.photoBoost * photo;
 return { id: b.id, score, parts: { text, space, time, photo, category } };
}

/** Rank existing reports against a new one. O(n · terms). */
export function findDuplicates(query: ReportLike, pool: ReportLike[], options: { threshold?: number; limit?: number; params?: DuplicateParams } = {}): DuplicateMatch[] {
 const { threshold = DUPLICATE_THRESHOLD, limit = 5, params = DUPLICATE } = options;
 const others = pool.filter(p => p.id !== query.id), docs = [query, ...others].map(r => tokenize(reportText(r)));
 const idf = inverseDocumentFrequency(docs), vectors = docs.map(d => tfidf(d, idf));
 return others.map((o, i) => scorePair(query, o, vectors[0], vectors[i + 1], params)).filter(m => m.score >= threshold).sort((x, y) => y.score - x.score).slice(0, limit);
}

/** Every pair above the threshold in one pass over the pool: O(n²) comparisons, each report tokenised once. */
export function duplicatePairs(pool: ReportLike[], threshold = DUPLICATE_THRESHOLD, params: DuplicateParams = DUPLICATE) {
 const docs = pool.map(r => tokenize(reportText(r))), idf = inverseDocumentFrequency(docs), vectors = docs.map(d => tfidf(d, idf));
 const pairs: { a: string; b: string; match: DuplicateMatch }[] = [];
 for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
  const match = scorePair(pool[i], pool[j], vectors[i], vectors[j], params);
  if (match.score >= threshold) pairs.push({ a: pool[i].id, b: pool[j].id, match });
 }
 return pairs.sort((x, y) => y.match.score - x.match.score);
}

/** The rule most civic systems use: same room and category within a time window. */
export function ruleBaselineDuplicate(a: ReportLike, b: ReportLike, windowDays = 7) {
 return a.locationId === b.locationId && a.category === b.category && Math.abs(a.createdAt - b.createdAt) <= windowDays * DAY;
}

/* ------------------------------------------------- 4. Perceptual photo hash */

/** Rec. 601 luma from an RGBA buffer. */
export function grayscale(rgba: ArrayLike<number>, pixels: number): number[] {
 const out = new Array<number>(pixels);
 for (let i = 0; i < pixels; i++) out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
 return out;
}

/**
 * dHash (Krawetz): shrink to 9×8 grey pixels, set bit (x, y) when pixel (x, y) is brighter than
 * (x + 1, y). 64 bits, written as 16 hex characters. Robust to scaling, brightness and compression.
 */
export function dHash(gray9x8: ArrayLike<number>): string {
 if (gray9x8.length !== 72) throw new Error('dHash expects 9 × 8 = 72 grey values.');
 let hex = '';
 for (let y = 0; y < 8; y++) {
  let byte = 0;
  for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray9x8[y * 9 + x] > gray9x8[y * 9 + x + 1] ? 1 : 0);
  hex += byte.toString(16).padStart(2, '0');
 }
 return hex;
}

const POPCOUNT = Array.from({ length: 16 }, (_, n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1));
export function isPhotoHash(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value); }
export function hamming(a: string, b: string): number {
 if (!isPhotoHash(a) || !isPhotoHash(b)) return 64;
 let d = 0;
 for (let i = 0; i < 16; i++) d += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
 return d;
}
/**
 * Pairs of reports whose photos are near-identical. H ≤ 6 of 64 bits is deliberately strict: a re-encoded
 * or resized copy of one photo lands at 0 to 4, while different scenes typically sit at 20 or more, and
 * flat, low-texture scenes (a bare wall) can fall near 10, so a looser bound raises false alarms.
 */
export function photoReuse(reports: { id: string; photoHash?: string | null }[], maxDistance = 6) {
 const withHash = reports.filter(r => isPhotoHash(r.photoHash));
 const pairs: { a: string; b: string; distance: number }[] = [];
 for (let i = 0; i < withHash.length; i++) for (let j = i + 1; j < withHash.length; j++) {
  const distance = hamming(withHash[i].photoHash!, withHash[j].photoHash!);
  if (distance <= maxDistance) pairs.push({ a: withHash[i].id, b: withHash[j].id, distance });
 }
 return pairs.sort((x, y) => x.distance - y.distance);
}

/* ------------------------------------------------- 5. Beta reputation */

export type Credibility = { score: number; low: number; high: number; alpha: number; beta: number; reports: number; label: 'New reporter' | 'Reliable' | 'Mixed' | 'Doubtful' };

/**
 * Reporter credibility as the expected value of Beta(α, β), α = 1 + verified reports,
 * β = 1 + reports staff marked not confirmed. Duplicates are neutral. The 95% interval
 * uses the normal approximation, mean ± 1.96·√(αβ / ((α+β)²(α+β+1))).
 */
export function betaReputation(verified: number, rejected: number, prior = { alpha: 1, beta: 1 }): Credibility {
 const alpha = prior.alpha + Math.max(0, verified), beta = prior.beta + Math.max(0, rejected), n = alpha + beta;
 const score = alpha / n, sd = Math.sqrt(alpha * beta / (n * n * (n + 1)));
 const reports = verified + rejected;
 const label = reports < 3 ? 'New reporter' : score >= 0.75 ? 'Reliable' : score >= 0.5 ? 'Mixed' : 'Doubtful';
 return { score, low: clamp01(score - 1.96 * sd), high: clamp01(score + 1.96 * sd), alpha, beta, reports, label };
}

/* ------------------------------------------------- 6. Priority score */

export const CATEGORY_SEVERITY: Record<string, number> = { Lifts: 0.9, Electrical: 0.85, 'Drinking water': 0.75, Plumbing: 0.65, 'Classroom technology': 0.5, Appliances: 0.45, 'Gym equipment': 0.45, Other: 0.35, Furniture: 0.3 };
export const SAFETY_TERMS = ['spark', 'shock', 'smoke', 'fire', 'burn', 'exposed', 'live wire', 'short circuit', 'leak', 'flood', 'overflow', 'slippery', 'gas', 'smell', 'stuck', 'trapped', 'glass', 'sharp', 'injur', 'hazard', 'danger', 'collapse', 'crack', 'fall'];
export type PriorityWeights = { severity: number; safety: number; crowd: number; age: number; staff: number; credibility: number };
export const PRIORITY_WEIGHTS: PriorityWeights = { severity: 0.25, safety: 0.2, crowd: 0.15, age: 0.15, staff: 0.15, credibility: 0.1 };
export type PriorityInput = { category: string; text: string; reports?: number; followers?: number; ageHours: number; reviewHours: number; staffPriority?: string | null; credibility?: number | null; open?: boolean };
export type PriorityFactor = { key: keyof PriorityWeights; label: string; value: number; weight: number; contribution: number; detail: string };
export type PriorityResult = { score: number; band: 'Critical' | 'High' | 'Medium' | 'Low'; factors: PriorityFactor[] };

export function safetyHits(text: string) { const t = text.toLowerCase(); return SAFETY_TERMS.filter(term => t.includes(term)); }

/**
 * P = 100 · Σ wᵢ·fᵢ / Σ wᵢ over the factors that apply, every fᵢ ∈ [0, 1]:
 *  severity    category severity table
 *  safety      min(1, safety terms found / 2)
 *  crowd       1 − exp(−(extra reports + followers) / 2)
 *  age         min(1, hours open / (2 × review target)), 0 once resolved
 *  staff       verified priority: Low 0.3, Medium 0.6, High 1 (absent before verification)
 *  credibility reporter's Beta reputation (absent for viewers who may not see it)
 * Bands: ≥ 75 Critical, ≥ 55 High, ≥ 35 Medium, else Low.
 */
export function priorityScore(input: PriorityInput, weights: PriorityWeights = PRIORITY_WEIGHTS): PriorityResult {
 const hits = safetyHits(input.text), extra = Math.max(0, (input.reports || 1) - 1) + Math.max(0, input.followers || 0);
 const staff = input.staffPriority ? ({ Low: 0.3, Medium: 0.6, High: 1 } as Record<string, number>)[input.staffPriority] ?? null : null;
 const raw: [keyof PriorityWeights, string, number | null, string][] = [
  ['severity', 'Category severity', CATEGORY_SEVERITY[input.category] ?? 0.35, input.category],
  ['safety', 'Safety words', Math.min(1, hits.length / 2), hits.length ? hits.slice(0, 3).join(', ') : 'none found'],
  ['crowd', 'Others affected', 1 - Math.exp(-extra / 2), extra ? `${extra} more report${extra === 1 ? '' : 's'} or followers` : 'only the reporter'],
  ['age', 'Waiting time', input.open === false ? 0 : Math.min(1, input.ageHours / (2 * Math.max(1, input.reviewHours))), `${Math.round(input.ageHours)} h of a ${input.reviewHours} h target`],
  ['staff', 'Staff priority', staff, input.staffPriority || 'not verified yet'],
  ['credibility', 'Reporter record', input.credibility ?? null, input.credibility == null ? 'hidden' : `${Math.round(input.credibility * 100)}% reliable`],
 ];
 const present = raw.filter(([, , v]) => v != null) as [keyof PriorityWeights, string, number, string][];
 const weightSum = present.reduce((s, [k]) => s + weights[k], 0) || 1;
 const factors = present.map(([key, label, value, detail]) => ({ key, label, value, weight: weights[key] / weightSum, contribution: 100 * value * weights[key] / weightSum, detail }));
 const score = Math.round(factors.reduce((s, f) => s + f.contribution, 0));
 return { score, band: score >= 75 ? 'Critical' : score >= 55 ? 'High' : score >= 35 ? 'Medium' : 'Low', factors };
}

/* ------------------------------------------------- 7. Technician assignment */

/**
 * Kuhn–Munkres (Hungarian) algorithm with potentials, O(n²·m) for n rows ≤ m columns.
 * Returns assignment[row] = column minimising the total cost.
 */
export function hungarian(cost: number[][]): number[] {
 const n = cost.length; if (!n) return [];
 const m = cost[0].length; if (m < n) throw new Error('Hungarian: needs at least as many columns as rows.');
 const INF = Number.MAX_SAFE_INTEGER, u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
 for (let i = 1; i <= n; i++) {
  p[0] = i; let j0 = 0;
  const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
  do {
   used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
   for (let j = 1; j <= m; j++) if (!used[j]) {
    const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
    if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
    if (minv[j] < delta) { delta = minv[j]; j1 = j; }
   }
   for (let j = 0; j <= m; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
   j0 = j1;
  } while (p[j0] !== 0);
  do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
 }
 const assignment = new Array(n).fill(-1);
 for (let j = 1; j <= m; j++) if (p[j]) assignment[p[j] - 1] = j - 1;
 return assignment;
}

export type AssignmentJob = { id: string; category: string; siteId: string; priority?: number };
export type AssignmentTechnician = { id: string; name: string; load: number; resolved: Record<string, number>; sites: string[] | '*' };
export type AssignmentSuggestion = { jobId: string; technicianId: string | null; cost: number; load: number; affinity: number };
export const ASSIGNMENT = { capacity: 3, loadWeight: 0.6, skillWeight: 0.4, unassignedCost: 1.5, infeasible: 1e6 };

/** Laplace-smoothed share of a technician's resolved jobs in this category. */
export function categoryAffinity(t: AssignmentTechnician, category: string, categories = 9) {
 const total = Object.values(t.resolved).reduce((s, n) => s + n, 0);
 return ((t.resolved[category] || 0) + 1) / (total + categories);
}

/**
 * Each technician becomes `capacity` slots; slot k costs
 *  c = wL · min(1, (load + k) / (2·capacity)) + wS · (1 − affinity / max affinity for the job)
 * plus one "leave unassigned" column per job, so the matrix is always wide enough.
 * Jobs are taken in priority order when there are more jobs than slots.
 */
export function suggestAssignments(jobs: AssignmentJob[], technicians: AssignmentTechnician[], options: Partial<typeof ASSIGNMENT> = {}) {
 const o = { ...ASSIGNMENT, ...options };
 const slots = technicians.flatMap(t => Array.from({ length: o.capacity }, (_, k) => ({ t, k })));
 const ordered = [...jobs].sort((a, b) => (b.priority || 0) - (a.priority || 0));
 const best = ordered.map(job => Math.max(1e-9, ...technicians.map(t => categoryAffinity(t, job.category))));
 const part = (job: AssignmentJob, t: AssignmentTechnician, k: number, i: number) => {
  const load = Math.min(1, (t.load + k) / (2 * o.capacity)), affinity = categoryAffinity(t, job.category) / best[i];
  const feasible = t.sites === '*' || t.sites.includes(job.siteId);
  return { load, affinity, cost: feasible ? o.loadWeight * load + o.skillWeight * (1 - affinity) : o.infeasible };
 };
 const matrix = ordered.map((job, i) => [...slots.map(({ t, k }) => part(job, t, k, i).cost), ...ordered.map(() => o.unassignedCost)]);
 const chosen = hungarian(matrix);
 const suggestions: AssignmentSuggestion[] = ordered.map((job, i) => {
  const col = chosen[i];
  if (col < 0 || col >= slots.length || matrix[i][col] >= o.infeasible) return { jobId: job.id, technicianId: null, cost: o.unassignedCost, load: 0, affinity: 0 };
  const { t, k } = slots[col], p = part(job, t, k, i);
  return { jobId: job.id, technicianId: t.id, cost: p.cost, load: p.load, affinity: p.affinity };
 });
 const costTable = ordered.map((job, i) => technicians.map(t => part(job, t, 0, i).cost));
 return { suggestions, costTable, jobs: ordered.map(j => j.id), technicians: technicians.map(t => t.id), total: suggestions.reduce((s, x) => s + x.cost, 0) };
}

/* ------------------------------------------------- 8. ST-DBSCAN hotspots */

export type SpatioTemporalPoint = { id: string; latitude: number; longitude: number; time: number; category?: string; buildingId?: string };
export type Hotspot = { id: number; members: string[]; latitude: number; longitude: number; radius: number; start: number; end: number; categories: Record<string, number> };
/** Room scale and one week: the best F1 in the simulated parameter grid (docs/ALGORITHMS-EVALUATION.md § 4). */
export const HOTSPOT = { epsMetres: 15, epsDays: 7, minPoints: 4 };

/**
 * ST-DBSCAN: p and q are neighbours when d(p, q) ≤ ε₁ metres and |t(p) − t(q)| ≤ ε₂ days.
 * A point with ≥ minPts neighbours (itself included) is a core point; clusters grow from
 * core points through density reachability; the rest is noise. O(n²) with the naive range query.
 */
export function stDbscan(points: SpatioTemporalPoint[], options: Partial<typeof HOTSPOT> = {}) {
 const { epsMetres, epsDays, minPoints } = { ...HOTSPOT, ...options };
 const n = points.length, labels = new Array<number>(n).fill(0); // 0 unvisited, −1 noise, ≥1 cluster
 const neighbours = (i: number) => {
  const out: number[] = [];
  for (let j = 0; j < n; j++) if (Math.abs(points[i].time - points[j].time) <= epsDays * DAY && haversine(points[i], points[j]) <= epsMetres) out.push(j);
  return out;
 };
 let cluster = 0;
 for (let i = 0; i < n; i++) {
  if (labels[i] !== 0) continue;
  const seeds = neighbours(i);
  if (seeds.length < minPoints) { labels[i] = -1; continue; }
  cluster++; labels[i] = cluster;
  const queue = seeds.filter(j => j !== i);
  while (queue.length) {
   const j = queue.shift()!;
   if (labels[j] === -1) labels[j] = cluster;
   if (labels[j] !== 0) continue;
   labels[j] = cluster;
   const next = neighbours(j);
   if (next.length >= minPoints) for (const q of next) if (labels[q] === 0 || labels[q] === -1) queue.push(q);
  }
 }
 const hotspots: Hotspot[] = [];
 for (let c = 1; c <= cluster; c++) hotspots.push(summariseCluster(c, points.filter((_, i) => labels[i] === c)));
 return { hotspots: hotspots.sort((a, b) => b.members.length - a.members.length), noise: points.filter((_, i) => labels[i] === -1).map(p => p.id), labels: Object.fromEntries(points.map((p, i) => [p.id, labels[i]])) };
}

function summariseCluster(id: number, members: SpatioTemporalPoint[]): Hotspot {
 const latitude = members.reduce((s, p) => s + p.latitude, 0) / members.length, longitude = members.reduce((s, p) => s + p.longitude, 0) / members.length;
 const categories: Record<string, number> = {};
 for (const p of members) if (p.category) categories[p.category] = (categories[p.category] || 0) + 1;
 return { id, members: members.map(p => p.id), latitude, longitude, radius: Math.max(...members.map(p => haversine(p, { latitude, longitude }))), start: Math.min(...members.map(p => p.time)), end: Math.max(...members.map(p => p.time)), categories };
}

/* ------------------------------------------------- 8b. Space-time permutation scan */

export type ScanCluster = Hotspot & { observed: number; expected: number; llr: number; p: number; significant: boolean; scanRadius: number; windowDays: number };
export const SCAN = { radii: [15, 30, 50], windows: [3, 7, 14], replicates: 99, minPoints: 3, alpha: 0.05, maxClusters: 8, seed: 20261111 };

/** Small seeded PRNG so a scan's p-values are reproducible. */
export function mulberry32(seed: number) {
 return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const lowerBound = (a: number[], x: number) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
const upperBound = (a: number[], x: number) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };

/**
 * Space-time permutation scan statistic (Kulldorff et al., 2005). A candidate cluster is a cylinder: the
 * reports within r metres of a report, during w days starting at one of them. If a report's time does not
 * depend on its place, the expected count in a cylinder is
 *   μ = N_circle · N_window / N
 * (reports in the circle at any time, times reports anywhere in the window, over all reports), and for
 * c > μ its log-likelihood ratio is
 *   LLR = c · ln(c / μ) + (N − c) · ln((N − c) / (N − μ)).
 * Significance is Monte Carlo: shuffle the times among the places R times, keep each shuffle's largest
 * LLR, and p = (1 + #{shuffles at least as large}) / (R + 1). Because μ comes from each place's own share
 * of reports, a room that is always busy is not a hotspot; a burst beyond its usual rate is. Clusters are
 * taken greedily by LLR without sharing reports. O(R · C · |windows| · k log N) for C distinct circles of
 * up to k reports.
 */
export function spaceTimeScan(points: SpatioTemporalPoint[], options: Partial<typeof SCAN> = {}) {
 const o = { ...SCAN, ...options }, n = points.length;
 if (n < o.minPoints) return { clusters: [] as ScanCluster[], replicates: o.replicates, candidates: 0 };
 const seen = new Set<string>(), circles: { radius: number; members: number[] }[] = [];
 for (let i = 0; i < n; i++) for (const radius of o.radii) {
  const members: number[] = [];
  for (let j = 0; j < n; j++) if (haversine(points[i], points[j]) <= radius) members.push(j);
  const key = members.join(',');
  if (members.length >= o.minPoints && !seen.has(key)) { seen.add(key); circles.push({ radius, members }); }
 }
 type Candidate = { llr: number; circle: number; from: number; to: number; window: number; c: number; mu: number };
 const scan = (times: number[], collect: Candidate[] | null) => {
  const all = [...times].sort((a, b) => a - b);
  let best = 0;
  circles.forEach((circle, ci) => {
   const ts = circle.members.map(j => times[j]).sort((a, b) => a - b), size = ts.length;
   for (const w of o.windows) {
    let hi = 0;
    for (let lo = 0; lo < size; lo++) {
     if (lo && ts[lo] === ts[lo - 1]) continue;
     const to = ts[lo] + w * DAY;
     while (hi < size && ts[hi] <= to) hi++;
     const c = hi - lo;
     if (c < o.minPoints) continue;
     const mu = size * (upperBound(all, to) - lowerBound(all, ts[lo])) / n;
     if (c <= mu) continue;
     const llr = c * Math.log(c / mu) + (n > c ? (n - c) * Math.log((n - c) / (n - mu)) : 0);
     if (llr > best) best = llr;
     if (collect) collect.push({ llr, circle: ci, from: ts[lo], to, window: w, c, mu });
    }
   }
  });
  return best;
 };
 const candidates: Candidate[] = [], times = points.map(p => p.time);
 scan(times, candidates);
 const random = mulberry32(o.seed), maxima: number[] = [];
 for (let r = 0; r < o.replicates; r++) {
  const shuffled = [...times];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  maxima.push(scan(shuffled, null));
 }
 candidates.sort((a, b) => b.llr - a.llr);
 const used = new Set<number>(), clusters: ScanCluster[] = [];
 for (const k of candidates) {
  if (clusters.length >= o.maxClusters) break;
  const members = circles[k.circle].members.filter(j => times[j] >= k.from && times[j] <= k.to);
  if (members.some(j => used.has(j))) continue;
  members.forEach(j => used.add(j));
  const p = (1 + maxima.filter(m => m >= k.llr).length) / (o.replicates + 1);
  clusters.push({ ...summariseCluster(clusters.length + 1, members.map(j => points[j])), observed: k.c, expected: k.mu, llr: k.llr, p, significant: p <= o.alpha, scanRadius: circles[k.circle].radius, windowDays: k.window });
 }
 return { clusters, replicates: o.replicates, candidates: candidates.length };
}

/* ------------------------------------------------- 9. Trends */

export function weeklyTrend(items: { createdAt: number; resolvedAt?: number | null }[], weeks = 8, now = Date.now()) {
 const start = now - weeks * 7 * DAY;
 return Array.from({ length: weeks }, (_, i) => {
  const from = start + i * 7 * DAY, to = from + 7 * DAY;
  return { from, reported: items.filter(x => x.createdAt >= from && x.createdAt < to).length, resolved: items.filter(x => x.resolvedAt != null && x.resolvedAt >= from && x.resolvedAt < to).length };
 });
}
