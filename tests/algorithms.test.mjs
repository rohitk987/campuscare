import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenize,inverseDocumentFrequency,tfidf,cosine,trainNaiveBayes,predictNaiveBayes,evaluateClassifier,SEED_CORPUS,findDuplicates,duplicatePairs,ruleBaselineDuplicate,dHash,hamming,isPhotoHash,photoReuse,betaReputation,priorityScore,hungarian,suggestAssignments,stDbscan,weeklyTrend,duplicateScore,reportText,DUPLICATE,DUPLICATE_THRESHOLD,spaceTimeScan,mulberry32} from '../lib/algorithms.ts';

const DAY=86_400_000,now=Date.UTC(2026,10,10);

test('tokeniser lowercases, drops stop words and joins simple inflections',()=>{
 assert.deepEqual(tokenize('The tap is Leaking, leaked and LEAKS!'),['tap','leak','leak','leak']);
});

test('tf-idf cosine is 1 for identical text, 0 for disjoint text',()=>{
 const docs=[tokenize('fan not spinning'),tokenize('tap leaking')],idf=inverseDocumentFrequency(docs);
 assert.ok(Math.abs(cosine(tfidf(docs[0],idf),tfidf(docs[0],idf))-1)<1e-9);
 assert.equal(cosine(tfidf(docs[0],idf),tfidf(docs[1],idf)),0);
});

test('naive bayes trained on the seed corpus routes plain complaints to the right category',()=>{
 const model=trainNaiveBayes(SEED_CORPUS);
 assert.equal(predictNaiveBayes(model,'The ceiling fan in room 204 hums but does not spin').predictions[0].label,'Electrical');
 assert.equal(predictNaiveBayes(model,'Washroom tap keeps leaking water').predictions[0].label,'Plumbing');
 assert.equal(predictNaiveBayes(model,'Lift got stuck on the third floor').predictions[0].label,'Lifts');
 const result=predictNaiveBayes(model,'projector has no signal');
 assert.ok(Math.abs(result.predictions.reduce((s,p)=>s+p.probability,0)-1)<1e-9);
 assert.ok(result.evidence.some(e=>e.term==='projector'));
});

test('leave-one-out evaluation reports accuracy and a full confusion matrix; the lexicon helps',()=>{
 const r=evaluateClassifier(SEED_CORPUS),plain=evaluateClassifier(SEED_CORPUS,1,null);
 assert.ok(r.accuracy>0.7,`accuracy ${r.accuracy}`);
 assert.ok(r.accuracy>plain.accuracy,`lexicon ${r.accuracy} vs plain ${plain.accuracy}`);
 assert.equal(r.labels.length,9);
 assert.equal(Object.values(r.confusion).reduce((s,row)=>s+Object.values(row).reduce((a,b)=>a+b,0),0),SEED_CORPUS.length);
});

const base={id:'a',title:'Ceiling fan not spinning',item:'Fan near the window',description:'The fan hums but the blades do not turn',category:'Electrical',locationId:'r204',buildingId:'acad',createdAt:now};

test('a paraphrased report in the same room is a duplicate; a different fault is not',()=>{
 const pool=[{...base,id:'b',title:'Fan in room is not working',item:'window side fan',description:'blades not rotating since morning',createdAt:now-DAY},
  {...base,id:'c',title:'Projector shows no signal',item:'ceiling projector',description:'no signal with laptop',category:'Classroom technology',createdAt:now-DAY},
  {...base,id:'d',locationId:'lab2',buildingId:'labs',title:'Fan not spinning',createdAt:now-40*DAY}];
 const matches=findDuplicates(base,pool,{threshold:0.5});
 assert.equal(matches[0].id,'b');
 assert.ok(!matches.some(m=>m.id==='c'));
 assert.ok(matches.every(m=>m.score>=0.5));
});

test('a near-identical photo raises the duplicate score; categories that differ lower it',()=>{
 const other={...base,id:'e',title:'Fan issue',item:'',description:'',createdAt:now-3*DAY,photoHash:'ff00ff00ff00ff00'};
 const withPhoto=findDuplicates({...base,photoHash:'ff00ff00ff00ff01'},[other],{threshold:0})[0];
 const without=findDuplicates(base,[other],{threshold:0})[0];
 assert.ok(withPhoto.parts.photo>0.9);
 assert.ok(withPhoto.score>without.score);
 assert.equal(findDuplicates({...base,category:'Furniture'},[other],{threshold:0})[0].parts.category,0.75);
 assert.equal(duplicatePairs([base,other],0).length,1);
 assert.equal(ruleBaselineDuplicate(base,other),true);
});

test('place and time must both hold; a nearby room counts by distance; an unlike photo is not evidence against',()=>{
 const idf=inverseDocumentFrequency([base].map(r=>tokenize(reportText(r))));
 const copy={...base,id:'copy',createdAt:now-DAY};
 const monthLater=duplicateScore(base,{...copy,createdAt:now-40*DAY},idf),sameWeek=duplicateScore(base,copy,idf);
 assert.ok(monthLater.score<0.1&&sameWeek.score>0.8,`same room a month apart ${monthLater.score}, same week ${sameWeek.score}`);
 const at=(r,dLat)=>({...r,latitude:13.1337+dLat,longitude:77.5681});
 const nextDoor=duplicateScore(at(base,0),at({...copy,locationId:'r205'},0.0001),idf),farWing=duplicateScore(at(base,0),at({...copy,locationId:'r230'},0.0008),idf);
 assert.ok(nextDoor.parts.space>0.6&&farWing.parts.space<0.1,`11 m ${nextDoor.parts.space}, 88 m ${farWing.parts.space}`);
 assert.equal(duplicateScore(base,{...copy,locationId:'r230'},idf).parts.space,DUPLICATE.sameBuilding,'no capture points: same building only');
 const unlike=duplicateScore({...base,photoHash:'0000000000000000'},{...copy,photoHash:'ffffffffffffffff'},idf);
 assert.equal(unlike.parts.photo,0);
 assert.equal(unlike.score,sameWeek.score);
 const pairs=duplicatePairs([base,copy,{...copy,id:'far',buildingId:'labs',locationId:'lab1'}],0);
 assert.ok(Math.abs(pairs.find(p=>p.b==='copy').match.score-sameWeek.score)<1e-12,'the pairwise pass scores like duplicateScore');
 assert.equal(DUPLICATE_THRESHOLD<sameWeek.score,true);
});

test('dHash is 16 hex characters and Hamming distance counts differing bits',()=>{
 const ramp=Array.from({length:72},(_,i)=>i%9);
 const h=dHash(ramp);
 assert.equal(h,'0000000000000000');
 assert.equal(dHash(ramp.map(v=>8-v)),'ffffffffffffffff');
 assert.equal(hamming('0000000000000000','ffffffffffffffff'),64);
 assert.equal(hamming('0000000000000000','0000000000000003'),2);
 assert.equal(isPhotoHash('xyz'),false);
 assert.deepEqual(photoReuse([{id:'p',photoHash:'0000000000000000'},{id:'q',photoHash:'0000000000000001'},{id:'r',photoHash:'ffffffffffffffff'}]),[{a:'p',b:'q',distance:1}]);
 assert.throws(()=>dHash([1,2,3]));
});

test('beta reputation starts neutral and moves with verified and rejected reports',()=>{
 assert.equal(betaReputation(0,0).score,0.5);
 assert.equal(betaReputation(0,0).label,'New reporter');
 const good=betaReputation(9,1),bad=betaReputation(1,6);
 assert.ok(good.score>0.8&&good.label==='Reliable');
 assert.equal(bad.label,'Doubtful');
 assert.ok(good.low<good.score&&good.score<good.high);
});

test('priority rises with safety words, crowd and waiting time, and explains itself',()=>{
 const quiet=priorityScore({category:'Furniture',text:'chair wobbles',ageHours:1,reviewHours:24});
 const urgent=priorityScore({category:'Electrical',text:'switch board sparking with smoke',reports:3,followers:2,ageHours:60,reviewHours:24,staffPriority:'High',credibility:0.9});
 assert.ok(urgent.score>quiet.score);
 assert.equal(urgent.band,'Critical');
 assert.equal(quiet.band,'Low');
 assert.ok(Math.abs(urgent.factors.reduce((s,f)=>s+f.contribution,0)-urgent.score)<1);
 assert.ok(Math.abs(quiet.factors.reduce((s,f)=>s+f.weight,0)-1)<1e-9,'weights renormalise over the factors present');
 assert.equal(quiet.factors.find(f=>f.key==='staff'),undefined);
});

test('hungarian finds the minimum-cost assignment, including rectangular matrices',()=>{
 assert.deepEqual(hungarian([[4,1,3],[2,0,5],[3,2,2]]),[1,0,2]);
 assert.deepEqual(hungarian([[9,1],[1,9]]),[1,0]);
 assert.deepEqual(hungarian([[5,1,9]]),[1]);
 assert.throws(()=>hungarian([[1],[2]]));
});

test('assignment prefers the experienced, less loaded technician and respects site scope',()=>{
 const techs=[{id:'busy',name:'Busy',load:5,resolved:{Electrical:10},sites:'*'},{id:'free',name:'Free',load:0,resolved:{Electrical:6},sites:'*'},{id:'other',name:'Other site',load:0,resolved:{Electrical:20},sites:['site-2']}];
 const r=suggestAssignments([{id:'j1',category:'Electrical',siteId:'site-1'}],techs);
 assert.equal(r.suggestions[0].technicianId,'free');
 const none=suggestAssignments([{id:'j2',category:'Plumbing',siteId:'site-9'}],[techs[2]]);
 assert.equal(none.suggestions[0].technicianId,null);
 const many=suggestAssignments(Array.from({length:4},(_,i)=>({id:'k'+i,category:'Electrical',siteId:'site-1'})),[techs[1]],{capacity:3});
 assert.equal(many.suggestions.filter(s=>s.technicianId).length,3,'capacity caps a technician at three new jobs');
});

test('st-dbscan groups repeated faults close in space and time and leaves strays as noise',()=>{
 const at=(id,dLat,days,category='Plumbing')=>({id,latitude:13.1337+dLat,longitude:77.5681,time:now-days*DAY,category});
 const points=[at('a',0,1),at('b',0.0001,3),at('c',0.0002,5),at('d',0.00015,8),at('far',0.01,2),at('old',0,200)];
 const r=stDbscan(points,{epsMetres:40,epsDays:30,minPoints:3});
 assert.equal(r.hotspots.length,1);
 assert.deepEqual([...r.hotspots[0].members].sort(),['a','b','c','d']);
 assert.deepEqual([...r.noise].sort(),['far','old']);
 assert.equal(r.hotspots[0].categories.Plumbing,4);
});

test('the space-time scan finds a burst beyond a room\'s usual rate and leaves a steadily busy room alone',()=>{
 const random=mulberry32(7),points=[];
 const place=(x,y)=>({latitude:13.1337+y/110_540,longitude:77.5681+x/108_460});
 for(let i=0;i<120;i++)points.push({id:'bg'+i,...place(random()*300,random()*60),time:now-random()*180*DAY});
 for(let i=0;i<14;i++)points.push({id:'busy'+i,...place(200,30),time:now-(i+0.5)*(180/14)*DAY});
 for(let i=0;i<7;i++)points.push({id:'burst'+i,...place(60+random()*4,10+random()*4),time:now-(40+random()*5)*DAY});
 const r=spaceTimeScan(points,{replicates:199});
 const top=r.clusters[0];
 assert.ok(top.significant,`p ${top.p}`);
 assert.ok(top.members.filter(id=>id.startsWith('burst')).length>=6,`top cluster ${top.members.join(',')}`);
 assert.ok(top.observed>top.expected*3);
 assert.ok(!r.clusters.some(c=>c.significant&&c.members.filter(id=>id.startsWith('busy')).length>=4),'an evenly busy room is not a hotspot');
 assert.deepEqual(spaceTimeScan(points,{replicates:199}).clusters.map(c=>c.p),r.clusters.map(c=>c.p),'seeded, so p-values repeat');
 assert.equal(spaceTimeScan(points.slice(0,2)).clusters.length,0);
});

test('weekly trend counts reports and resolutions per week',()=>{
 const t=weeklyTrend([{createdAt:now-1*DAY,resolvedAt:now-1000},{createdAt:now-9*DAY,resolvedAt:null},{createdAt:now-100*DAY}],2,now);
 assert.deepEqual(t.map(w=>[w.reported,w.resolved]),[[1,0],[1,1]]);
});

test('plain-language readings name the reasons a match or a priority was given',async()=>{
 const {matchLabel,matchReasons,priorityReason,reporterLine,listText}=await import('../app/plain.ts');
 assert.equal(matchLabel(0.7),'Very likely the same');assert.equal(matchLabel(0.5),'Likely the same');assert.equal(matchLabel(0.36),'Possibly the same');
 assert.deepEqual(matchReasons({text:0.5,space:1,time:0.95,photo:0.9,category:0.75}),['same room','reported within a day','similar wording','same photo','filed under different categories']);
 assert.deepEqual(matchReasons({text:0,space:0.4,time:0.6,photo:0,category:1}),['same building','within a week']);
 const r=priorityScore({category:'Electrical',text:'switch board sparking with smoke',ageHours:1,reviewHours:24});
 assert.equal(priorityReason(r.factors),'Possible safety risk: spark, smoke. Electrical faults are urgent by default');
 assert.equal(priorityReason(priorityScore({category:'Furniture',text:'chair wobbles',ageHours:60,reviewHours:24}).factors),'Waiting 60 h of a 24 h target');
 assert.equal(reporterLine(betaReputation(3,1)),'3 of 4 reviewed reports confirmed');
 assert.equal(listText(['a','b','c']),'a, b and c');
});
