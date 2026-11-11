# CampusCare algorithms

CampusCare is a campus complaint system: a student or staff member reports a fault from the place it is in, with a location check and a photo; a verifier confirms it; an administrator assigns a technician; the reporter can reopen it. This document describes the algorithms added on top of that workflow, the reasons for each design, its parameters and cost, and how each was evaluated. It is written to support a research write-up, so every number here comes from `scripts/evaluate-algorithms.mjs`, whose full output is [ALGORITHMS-EVALUATION.md](ALGORITHMS-EVALUATION.md).

All algorithms live in one dependency-free file, [`lib/algorithms.ts`](../lib/algorithms.ts), shared by the Cloudflare Worker, the browser and the evaluation script. None of them reads the database or trusts the client's identity: the server gathers only what the viewer may see (`lib/insights.ts`) and passes plain data in.

| # | Problem | Algorithm | Runs in | Cost |
|---|---|---|---|---|
| 1 | Which category is this report? | Lexicon-augmented multinomial Naive Bayes | Browser, while typing | O(tokens · classes) per report |
| 2 | Has this already been reported? | Place × time gated duplicate score with wording and photo | Browser (new report), Worker (review) | O(n · terms) per report, O(n²) for all pairs |
| 3 | Is this photo recycled? | 64-bit dHash and Hamming distance | Browser (capture and review), Worker (pairs) | O(1) per hash, O(n²) for all pairs |
| 4 | How far can a reporter be trusted? | Beta reputation with a 95% interval | Worker | O(1) per reporter |
| 5 | What should be fixed first? | Explainable weighted priority score | Worker, browser lab | O(1) per complaint |
| 6 | Who should repair it? | Hungarian algorithm over technician capacity slots | Worker, browser lab | O(n² · m) |
| 7 | Where are faults clustering? | ST-DBSCAN, and the space-time permutation scan statistic | Worker (summary), browser lab | O(n²); scan O(R · C · W · k log n) |
| 8 | Is the backlog growing? | Weekly reported and resolved counts | Worker | O(n · weeks) |

## 1. What already exists, and the gap

Campus complaint systems are common and mostly workflow tools. CampusCare 360 at MIT University tracks complaints and assets with a complaint ID and a staff portal ([MIT University](https://mituniversity.ac.in/CampusCare360/)); IIT Kanpur's Campus Care app offers complaint management ([IIT Kanpur](https://www.iitk.ac.in/doip/campus-care-app)); commercial maintenance systems such as SchoolDude, now Brightly, serve many campuses ([Chaffey College help desk](https://helpdesk.chaffey.edu/TDClient/107/IT-HelpDesk/KB/Article/18199/SchoolDude-Rebranded-Brightly)). Published student-complaint research concentrates on routing text to a department and on urgency: Javed et al. compared six classifiers for routing student complaints and evaluated with accuracy, precision, recall and F1 ([IJAIMS](https://ijaims.smiu.edu.pk/index.php/AIMS/article/download/135/40)); Kiruthiga et al. describe classification, urgency assessment and escalation of educational grievances ([EPJ Web of Conferences, RIACT 2026](https://www.epj-conferences.org/articles/epjconf/pdf/2026/23/epjconf_riact2026_04002.pdf)); a campus service hub predicts low, medium or high priority with a hosted model ([IJERT](https://www.ijert.org/unified-campus-service-hub-ijertv15is030973)).

Civic reporting systems face the duplicate problem at scale. SeeClickFix advertises automatic duplicate detection without describing the method ([CivicPlus](https://www.civicplus.com/?p=25842)). Infor Public Sector documents its rule: requests within a GIS radius, created within a time window, optionally of the same request type ([Infor documentation](https://docs.infor.com/pub/11.2.x/en-us/pubolh/qck1616706848365.html)). Open311 data marks duplicates with a parent request id ([Austin 3-1-1](https://austintexas.gov/page/get-service-requests), [GeoReport bulk specification](https://wiki.open311.org/GeoReport/bulk)), and San Francisco notes that crowdsourced descriptions make duplicates hard to identify ([DataSF](https://support.datasf.org/help/311-case-data-faq)). Building-maintenance studies mine request text to find the rooms where faults recur ([Trieste, 33 buildings](https://arts.units.it/bitstream/11368/2993408/5/Operational%2btext%2bmining%2bmethods%2bfor%2benhancing%2bbuilding%2bmaintenance%2bmanagement-Post_print.pdf)), and ST-DBSCAN is a standard extension of DBSCAN with separate spatial and temporal distances ([Atluri et al., survey](https://arxiv.org/pdf/1711.04710)).

What these leave open, and what CampusCare adds:

- **Evidence integrity.** None of the systems above checks whether a report's photo was recycled or whether the reporter has a record of confirmed reports. CampusCare fingerprints every capture with a perceptual hash and keeps a Beta reputation per reporter.
- **Duplicates beyond the radius rule.** The radius-window-type rule misses copies filed from the next room or under a neighbouring category. CampusCare scores every pair, and the evaluation measures both against the same labelled data.
- **Explainable triage.** Priority is a published formula whose factors are shown, and technician assignment is an optimal matching with workload limits, not first come, first served.
- **Hotspots with a significance test.** Density clustering finds groups; the scan statistic says whether a group exceeds that place's usual rate.
- **Reproducible evaluation.** A seeded simulator, train and test terms, and baselines for every algorithm.

## 2. Text representation

Used by the classifier and the duplicate score.

- **Tokens:** lower-case, Unicode-normalised, punctuation removed, words of one character, numbers and about 125 stop words dropped (including campus filler such as *room*, *floor*, *block*).
- **Light stemming:** strip *-ing* (words over 5 letters), *-ies* → *-y*, *-ed*, and a plural *-s*. This joins *leak, leaks, leaked, leaking* without the over-stemming of a full Porter stemmer.
- **Smoothed IDF:** idf(t) = ln((N + 1) / (df(t) + 1)) + 1, computed over the pool being compared. Terms not in the pool take the largest idf.
- **TF-IDF vector:** w(t, d) = tf(t, d) · idf(t), L2-normalised, so cosine similarity is a dot product in [0, 1].

## 3. Category suggestion: lexicon-augmented Naive Bayes

While a reporter types, CampusCare suggests a category and shows the words that decided it.

**Model.** Multinomial Naive Bayes with Laplace smoothing (McCallum and Nigam, 1998):

P(c | d) ∝ P(c) · Π_w P(w | c)^n(w, d), with P(w | c) = (n(w, c) + α) / (n(c) + α · |V|), α = 1.

Computed in log space and normalised with log-sum-exp.

**Lexicon prior.** A campus starts with no history, and the 90-report seed corpus (10 per category, `SEED_CORPUS`) is too small for word counts alone. Each category has a short hand-written lexicon (`CATEGORY_LEXICON`, for example *Lifts: lift elevator floor button door stuck jerk*). Every lexicon word adds 2 pseudo-occurrences to its category before training. This is a Bayesian prior over P(w | c): it dominates when data is scarce and fades as the campus's own complaints are added (the browser trains on the seed corpus plus every complaint the member can see that was not rejected or merged).

**Evidence.** The words shown to the user are those that most favour the winner c₁ over the runner-up c₂: weight(w) = log P(w | c₁) − log P(w | c₂), the top five with positive weight, shown as typed, not stemmed.

**Result** (leave-one-out on the seed corpus, 9 classes, chance 11.1%):

| Model | Accuracy | Macro F1 |
|---|---|---|
| Multinomial Naive Bayes, α = 1 | 34.4% | 0.32 |
| Lexicon-augmented Naive Bayes, α = 1 (CampusCare) | 78.9% | 0.79 |
| Lexicon-augmented Naive Bayes, α = 0.5 | 82.2% | 0.82 |

The weakest class is Appliances (F1 0.56), which shares words with Electrical (*fan*, *switch*) and Drinking water (*cooler*). Training is one counting pass, O(total tokens); prediction is O(tokens · classes).

## 4. Duplicate detection

When a reporter reaches the description step, CampusCare looks for open complaints that may be the same fault and offers to follow one instead. Verifiers see likely duplicates on each complaint and can link them.

**Score.** For reports a and b:

S(a, b) = c · s_place · s_time · (f + (1 − f) · s_text)

and, when both carry a photo and the photos are alike (s_photo > 0),

S ← S + (1 − S) · β · s_photo

| Signal | Definition | Default |
|---|---|---|
| s_place | 1 in the same room; otherwise exp(−d / λ) for the haversine distance d between capture points; otherwise a flat value for the same building; otherwise 0 | λ = 25 m, same building 0.4 |
| s_time | exp(−\|Δt\| / τ) | τ = 10 days (halves in about 7) |
| s_text | TF-IDF cosine | floor f = 0.4 |
| s_photo | clamp((1 − H/64 − 0.6) / 0.4), H the Hamming distance of the dHashes | boost β = 0.25 |
| c | 1 if the categories match, else a penalty | 0.75 |

The default match threshold is 0.35 (`DUPLICATE_THRESHOLD`).

**How the defaults were set.**

- **Scales and photo boost.** λ, τ and β were chosen by grid search on a simulated training term and are reported on a separate test term.
- **Text floor.** The simulation could not separate floors of 0.4 and 0.5: F1 and average precision differed by less than 0.03, and the sign changed between terms. So f follows a stated rule: two reports in different categories with no word in common must never match on place and time alone. That needs c · f < 0.35, so f = 0.4, giving 0.75 × 0.4 = 0.30.
- **Threshold.** The rule is also why the threshold sits at 0.35 rather than at the training term's F1-best value of 0.30.
- **What prompted the rule.** On the local test data, the first floor of 0.5 flagged a projector fault and a fan fault filed in the same room on the same day.

**Why this form.** One incident needs both the same place and the same time. A report in the same room a month later is usually a new fault, and so is one from the same week in another building, so place and time multiply rather than add. Wording separates different faults in the same place and week (*fan* versus *projector*), but paraphrases share few words (*not spinning*, *stopped rotating*), so text scales the score between f and 1 and cannot veto it. Photos are one-sided evidence: two people photograph one fault from different angles, so unlike photos prove nothing. Only alike photos count, and they can only raise the score. A category mismatch lowers the score but does not exclude the pair, because different reporters file the same fault differently.

**The first version failed.** CampusCare first used a weighted average, S = c · (0.45 text + 0.25 place + 0.15 time + 0.15 photo). In evaluation it lost to the plain rule (F1 0.30 against 0.69). Shared wording is common between unrelated faults of the same type across the campus, and an average lets it outvote place and time. Text alone cannot identify an incident at all (F1 0.04).

**Result.** Measured on the test term. Thresholds were chosen on a separate training term, except in the last row. 15% of second reports were filed under a neighbouring category.

| Method | Precision | Recall | F1 | Average precision |
|---|---|---|---|---|
| Rule: same room, same category, within 7 days | 0.84 | 0.58 | 0.69 | n/a |
| Text only | 0.03 | 0.05 | 0.04 | 0.04 |
| Weighted average (first version) | 0.59 | 0.20 | 0.30 | 0.34 |
| Place × time only | 0.72 | 0.65 | 0.68 | 0.74 |
| CampusCare | 0.85 | 0.86 | 0.86 | 0.93 |
| CampusCare at the fixed default threshold 0.35 | 0.90 | 0.81 | 0.85 | 0.93 |

The rule is precise but misses duplicates. Of 93 true pairs, 39 escape it because they were filed from a neighbouring room, under another category or more than a week apart; CampusCare finds 26 of them. Of 10 pairs that share a room, a category and a week but are different incidents, the rule merges all 10 and CampusCare merges 6. The rule's recall falls as reporting gets noisier, while CampusCare's barely moves:

| Second reports under another category | Rule F1 | CampusCare F1 | CampusCare average precision |
|---|---|---|---|
| 0% | 0.84 | 0.89 | 0.95 |
| 15% | 0.69 | 0.86 | 0.93 |
| 30% | 0.61 | 0.84 | 0.92 |

**Ablations:**

- **Wording:** lifts F1 from 0.68 (place × time alone) to 0.86.
- **Tolerating a category mismatch:** adds 0.14 over requiring categories to match (0.72).
- **Photo boost:** adds 0.03 F1 and 0.03 average precision. Its main job is the separate reuse check in § 5.

**Cost.** findDuplicates is O(n · terms) for one new report against n. duplicatePairs tokenises each report once and compares all pairs, O(n²); 600 reports take about 180 ms in Node.

## 5. Photo evidence integrity: dHash

Every report photo is fingerprinted in the browser at capture (`app/photo-hash.ts`). The hash is taken from the compressed JPEG that is actually uploaded, decoded again in the browser. An earlier version hashed the camera frame before compression; on plain, low-texture photos, compression noise then flipped bits, and a reviewer's check could wrongly report the photo as changed.

1. Draw the decoded image to a 9 × 8 canvas.
2. Convert to grey: Y = 0.299 R + 0.587 G + 0.114 B.
3. Set bit (x, y) when pixel (x, y) is brighter than pixel (x + 1, y). This gives 64 bits, written as 16 hex characters.

This is Krawetz's difference hash (2013). It survives resizing, re-compression and brightness changes. Two hashes are compared by Hamming distance H, the number of differing bits.

**Reuse threshold H ≤ 6.** A re-encoded or resized copy of one photo lands at 0 to 4 bits. Different scenes usually sit near 32, but flat, low-texture scenes such as a bare wall can fall near 10. A bound of 10 produced false alarms between two different plain images in testing, so 6 is the default. On the simulated test term the check found all 3 planted recycled photos and raised no other flag.

**Trust boundary.** The hash comes from the reporter's browser. The server stores it only if it matches `^[0-9a-f]{16}$` (tested in `tests/pilot-access.test.mjs`), and it is advisory evidence, never proof. When a reviewer opens a complaint, the ticket sheet recomputes the dHash from the stored photo it displays and shows whether the two agree. A hash supplied without the image cannot pass that check. A perceptual match is a lead for a human reviewer, and an adversary can craft images to collide with or evade a hash ([Ofcom, perceptual hashing](https://www.ofcom.org.uk/__data/assets/pdf_file/0036/247977/Perceptual-hashing-technology.pdf)).

## 6. Reporter credibility: Beta reputation

Each reporter's record is two counts: reports staff verified (r) and reports staff marked not confirmed (s). Duplicates are neutral, since a duplicate is a real fault reported twice. Following Jøsang and Ismail (2002):

- α = 1 + r, β = 1 + s (a uniform prior)
- score = E[Beta(α, β)] = α / (α + β)
- 95% interval = score ± 1.96 · √(αβ / ((α + β)² (α + β + 1))), clipped to [0, 1]
- labels: *New reporter* below 3 decided reports; then *Reliable* ≥ 0.75, *Mixed* ≥ 0.5, otherwise *Doubtful*

A new reporter starts at 0.5 with a wide interval, so one rejection does not condemn anyone. The interval is shown, not only the mean. The Beta system assumes most ratings are fair; here the ratings are staff decisions, not peer votes, which suits that assumption. Credibility is visible only to verifiers and administrators.

## 7. Priority score

P = 100 · Σᵢ wᵢ fᵢ / Σᵢ wᵢ, summed over the factors a complaint has, with every fᵢ ∈ [0, 1]:

| Factor | fᵢ | wᵢ |
|---|---|---|
| Category severity | table: Lifts 0.9, Electrical 0.85, Drinking water 0.75, Plumbing 0.65, Classroom technology 0.5, Appliances and Gym 0.45, Other 0.35, Furniture 0.3 | 0.25 |
| Safety words | min(1, matches / 2) over 24 hazard stems (*spark, shock, smoke, leak, stuck, trapped …*) | 0.20 |
| Others affected | 1 − exp(−(extra reports + followers) / 2) | 0.15 |
| Waiting time | min(1, hours open / (2 × the organisation's review target)), 0 once resolved | 0.15 |
| Staff priority | Low 0.3, Medium 0.6, High 1; absent until verified | 0.15 |
| Reporter record | Beta reputation score; absent when unknown or hidden | 0.10 |

**Bands:** Critical ≥ 75, High ≥ 55, Medium ≥ 35, otherwise Low.

Weights renormalise over the factors present, so an unverified complaint is not penalised for lacking a staff priority. Every complaint's score is a sum of visible contributions; reviewers see the breakdown, and the Insights lab lets them move the weights and watch the queue re-rank. Worked examples: a sparking switch board with three reports, 30 hours old, staff priority High, scores 86 (Critical); a single unverified leaking tap at 50 hours scores 56 (High); a wobbling chair reported two hours ago scores 11 (Low). The weights are a design choice, not learned, and are stated as such.

## 8. Technician assignment: Hungarian algorithm with capacity slots

Verified complaints awaiting assignment are matched to technicians to minimise total cost. This is the assignment problem, solved exactly by the Hungarian method (Kuhn, 1955; Munkres, 1957).

**Slots.** Each technician t becomes `capacity` = 3 slots. Slot k costs:

c(job, t, k) = w_L · min(1, (load_t + k) / (2 · capacity)) + w_S · (1 − a(t, job) / max_t′ a(t′, job))

- w_L = 0.6, w_S = 0.4.
- load_t is the technician's open jobs.
- a(t, category) = (resolved_t[category] + 1) / (resolved_t + 9) is a Laplace-smoothed share of the technician's past jobs in that category.

So a technician's third new job costs more than their first, and experience in the category lowers the cost.

**Feasibility.** A slot outside the technician's site scope costs 10⁶, which makes it infeasible. One "leave unassigned" column per job at cost 1.5 keeps the matrix wide enough and lets the plan decline a job rather than overload someone. Jobs are ordered by priority.

**Solver.** The O(n² · m) potentials form of Kuhn–Munkres for n jobs and m ≥ n columns.

**Result.** On 500 random instances (2 to 5 technicians, 3 to 12 jobs), the plan was never costlier than a greedy baseline (highest priority first, cheapest free slot) using the same cost matrix. It was strictly cheaper in 317 instances, lowered the mean plan cost by 5.0%, and lowered it by up to 32.4% on a single instance. Assigning 40 jobs to 8 technicians takes a millisecond or two. The plan is a suggestion: the reviewer's action form pre-fills it, and a person confirms it.

## 9. Hotspots

### 9.1 ST-DBSCAN

Points are complaints with a place and a time. Two points are neighbours when they are within ε₁ metres (haversine) and ε₂ days of each other. A point with at least minPts neighbours, itself included, is a core point. Clusters grow from core points by density reachability, and the remaining points are noise (Ester et al., 1996; Birant and Kut, 2007). The map default is ε₁ = 15 m, ε₂ = 7 days, minPts = 4. It is O(n²) with the naive range query.

### 9.2 Space-time permutation scan statistic

Density thresholds depend on how busy a campus is, and ST-DBSCAN cannot tell a burst from a room that is always busy. The scan statistic answers a sharper question: does this place have more reports in this window than its own usual share predicts? (Kulldorff et al., 2005.)

**Candidates.** Cylinders: a circle of radius r ∈ {15, 30, 50} m around a report, and a window of w ∈ {3, 7, 14} days starting at a report inside the circle.

**Expected count.** Under the null hypothesis a report's time is independent of its place, so the expected count in a cylinder is

μ = N_circle · N_window / N

that is, reports in the circle at any time, times reports anywhere in the window, divided by all reports.

**Score.** For an observed count c > μ:

LLR = c · ln(c / μ) + (N − c) · ln((N − c) / (N − μ))

**Significance.** Shuffle the dates among the places R times (99 in the app, 999 in the evaluation) and record each shuffle's largest LLR. Then p = (1 + #{shuffles with an LLR at least as large}) / (R + 1). The PRNG is seeded, so p-values repeat.

**Output.** Clusters are taken greedily by LLR without sharing reports. Secondary clusters are judged against the same maximum distribution, which is conservative.

**Cost.** O(R · C · W · k log n) for C distinct circles of up to k reports. With 99 shuffles that is under 100 ms for 100 reports, rising to about 7 s at 600. The app runs it only when a reviewer switches the map to *Significance*.

### 9.3 Result

The test term has 180 days and 246 reports: background at about one a day, 3 rooms that are busy all term, and 6 planted bursts of 5 reports in one room within 7 days. Precision and recall are counted over burst reports.

| Method | Bursts found | Busy rooms flagged | Precision | Recall | F1 |
|---|---|---|---|---|---|
| Spatial DBSCAN, 40 m | 6 of 6 | 3 of 3 | 0.12 | 1.00 | 0.22 |
| ST-DBSCAN 40 m, 30 days, 3 (first map default) | 6 of 6 | 3 of 3 | 0.12 | 1.00 | 0.22 |
| ST-DBSCAN 15 m, 7 days, 4 (map default) | 6 of 6 | 1 of 3 | 0.61 | 0.83 | 0.70 |
| Scan statistic, p ≤ 0.05 | 2 of 6 | 0 of 3 | 0.83 | 0.33 | 0.48 |

The two methods complement each other. ST-DBSCAN at room scale and one week finds every burst. But its parameters were chosen on this simulation, whose bursts last a week, so they suit bursts of that shape and need re-tuning for others. The scan statistic chooses its own radius and window and never flagged a steadily busy room, but it is conservative: after testing 26,513 candidates, only the strongest cluster (12 reports where 1.96 were expected, p = 0.001, two nearby bursts) cleared p ≤ 0.05. A single burst of 5 where 0.46 were expected scored p = 0.166. This is the expected price of controlling false alarms across many candidates.

## 10. Trend

Reports created and resolved per week over the last eight weeks, plotted as grouped bars. It is a plain count, included so the Insights page shows whether the backlog is growing.

## 11. Evaluation method

**Why simulation.** The pilot has too few real complaints to label, so every experiment uses a seeded simulator. The rates below are assumptions, chosen before the comparisons were run and stated so others can change them. Results describe the algorithms' behaviour under these assumptions, not field performance.

**Campus.** 3 buildings 150 m apart, each with 24 rooms on a 6 × 4 grid at 15 m spacing. Capture points are the room position plus Gaussian GPS error, σ = 8 m.

**Duplicate terms** (90 days, 120 incidents):

- Incidents arrive uniformly over the term, in 5 categories and 11 fault types.
- 30% of incidents land in six busy rooms (labs, washrooms, a lecture hall), so unrelated faults often share a room and a week. This was added after the first run, which spread incidents evenly and so under-represented dense rooms.
- Reports per incident: 1 (60%), 2 (25%), 3 (10%) or 4 (5%).
- Later reports arrive Exp(mean 1.5 days) after the first.
- 85% come from the same room and 15% from a neighbouring one.
- Each report has its own synonyms (3 subject and 4 problem phrasings per fault).
- 15% are filed under a neighbouring category (Electrical ↔ Appliances, Plumbing ↔ Drinking water, and so on).
- 70% carry a photo, another shot of the same scene 6 to 22 bits away.
- 3% of photos are recycled from an unrelated report.
- A training term (seed 101) fixes thresholds; a test term (seed 202) is reported.

**Hotspot term.** As described in § 9.3.

**Metrics:**

- Precision, recall and F1 on the positive class.
- Average precision, the area under the precision-recall curve.
- For the classifier: leave-one-out accuracy, macro F1 and the confusion matrix.

**Reproduce:**

```
node scripts/evaluate-algorithms.mjs
node --test tests/algorithms.test.mjs
```

The first writes `docs/ALGORITHMS-EVALUATION.md`. The second runs 15 unit tests, including the conjunctive behaviour of the duplicate score, the scan's handling of a busy room, and the seeded p-values.

**Threats to validity:**

- The simulator, its vocabulary and the parameters were written by the same team. The duplicate defaults were chosen on a training term and checked on a separate test term, but both come from one generator.
- Real wording is more varied than 11 fault templates.
- Real indoor GPS error is often larger than 8 m.
- Rooms on different floors share coordinates, and nothing here models floors.
- The classifier's evaluation corpus is hand-written.

A field evaluation on labelled campus history (duplicates staff actually linked, reports they rejected) is the next step and would replace these numbers.

## 12. Operating it: the To do view

Staff who run CampusCare day to day do not need the formulas. The Insights page therefore opens on a *To do* view that turns each output into a decision with a button:

| List | Comes from | One-click action (server rules still apply) |
|---|---|---|
| Jobs to assign | Hungarian plan (§ 8) | Assign, or Assign all (administrators) |
| Possible duplicates | Duplicate score (§ 4), shown as *Very likely*, *Likely* or *Possibly the same*, with reasons such as "same room, reported within a day" | Merge, after a confirm step, or Not the same |
| Photos to check | dHash reuse (§ 5) | Ask the reporter (requests information) |
| Repeated problems | ST-DBSCAN (§ 9.1) | Open the latest report |
| Fix first | Priority score (§ 7), with its largest factor as one sentence | Open |
| Reporters to watch | Beta reputation (§ 6), as "3 of 8 reviewed reports confirmed" | None |

**Flag levels.** One setting, *Fewer*, *Normal* or *More*, replaces the thresholds and distances. It is saved per browser.

| Level | Duplicates listed | Hotspot rule |
|---|---|---|
| Fewer | score ≥ 0.6 (*Very likely*) | 15 m, 7 days, 5 reports |
| Normal | score ≥ 0.45 (*Likely* and above) | 15 m, 7 days, 4 reports |
| More | score ≥ 0.35 (the evaluated threshold) | 25 m, 14 days, 3 reports |

*Normal* lists fewer duplicates than the evaluated threshold, because a work list should hold what is worth acting on. On the simulated test terms (the mean over six settings of category noise and busy rooms) this trades some recall for precision: F1 0.78 at 0.45 against 0.84 at 0.35. The report form and the complaint sheet, where a person reads each match, keep 0.35.

**How it works.** The second view holds the labs: every parameter, the map with both hotspot methods, the classifier with its confusion matrix. They are kept for the project report and for tuning. The complaint sheet follows the same pattern: plain sentences first, the numbers behind *How this was worked out*.

## 13. Privacy and access

- Analyses run on what the viewer may already see. The workspace list carries each complaint's priority score and band for anyone who can see the complaint.
- The factor breakdown, reporter credibility, duplicate candidates, photo-reuse checks and the Insights page are limited to verifiers and administrators. The API enforces this, and `tests/pilot-access.test.mjs` tests it.
- The reporter's duplicate check runs in the browser over complaints that member can see, using descriptions only where they may see the evidence.
- Photos are never sent anywhere for hashing: the hash is computed on the device.

## 14. Limitations and future work

- **Learned duplicate weights.** Treat duplicate detection as record linkage (Fellegi and Sunter, 1969). Estimate the match and non-match likelihoods of each signal from staff decisions: links made as duplicates, and pairs reviewed and kept apart.
- **Prospective scanning.** Use only windows that end today, as surveillance systems do. This reduces the number of candidates and so raises the scan's power for current outbreaks.
- **Floors and indoor position.** Use the selected floor and room as coordinates in place of GPS where the campus has a floor plan.
- **Language.** Students write in English mixed with Kannada and Hindi. The tokeniser and lexicon are English-only.
- **Scale.** All-pairs duplicate scoring and the scan are quadratic. A spatial grid index would make both near-linear in n for large campuses.

## References

- Atluri, G., Karpatne, A., and Kumar, V. (2018). Spatio-temporal data mining: a survey of problems and methods. *ACM Computing Surveys* 51(4). [arXiv:1711.04710](https://arxiv.org/pdf/1711.04710)
- Birant, D., and Kut, A. (2007). ST-DBSCAN: an algorithm for clustering spatial–temporal data. *Data & Knowledge Engineering* 60(1), 208–221.
- Ester, M., Kriegel, H.-P., Sander, J., and Xu, X. (1996). A density-based algorithm for discovering clusters in large spatial databases with noise. *Proceedings of KDD-96*, 226–231.
- Fellegi, I. P., and Sunter, A. B. (1969). A theory for record linkage. *Journal of the American Statistical Association* 64(328), 1183–1210.
- Jøsang, A., and Ismail, R. (2002). The Beta reputation system. *15th Bled Electronic Commerce Conference*. [PDF](https://mn.uio.no/ifi/english/people/aca/josang/publications/ji2002-bled.pdf)
- Krawetz, N. (2013). Kind of like that. *The Hacker Factor Blog* (the dHash algorithm).
- Kuhn, H. W. (1955). The Hungarian method for the assignment problem. *Naval Research Logistics Quarterly* 2(1–2), 83–97.
- Kulldorff, M., Heffernan, R., Hartman, J., Assunção, R., and Mostashari, F. (2005). A space–time permutation scan statistic for disease outbreak detection. *PLoS Medicine* 2(3), e59.
- McCallum, A., and Nigam, K. (1998). A comparison of event models for Naive Bayes text classification. *AAAI-98 Workshop on Learning for Text Categorization*.
- Munkres, J. (1957). Algorithms for the assignment and transportation problems. *Journal of the Society for Industrial and Applied Mathematics* 5(1), 32–38.
- Salton, G., and Buckley, C. (1988). Term-weighting approaches in automatic text retrieval. *Information Processing & Management* 24(5), 513–523.
- Systems and studies cited in § 1 are linked in place.
