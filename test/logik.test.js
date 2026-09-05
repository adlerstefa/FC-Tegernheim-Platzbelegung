// Tests der Fachlogik. Ausführen mit: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logik.js');

const buchung = (o) => Object.assign({ id:'b1', platzId:'p1', datum:'2026-09-12', von:'18:00', bis:'19:30', typ:'Training',
  mannschaft:'1. Mannschaft', kabinen:['Heim 1'], notiz:'', status:'genehmigt' }, o);

test('ueberlappt: angrenzende Zeiten überschneiden sich nicht', () => {
  assert.equal(L.ueberlappt(buchung({ von:'18:00', bis:'19:30' }), buchung({ von:'19:30', bis:'21:00' })), false);
});
test('ueberlappt: teilweise Überschneidung am selben Tag', () => {
  assert.equal(L.ueberlappt(buchung({ von:'18:00', bis:'19:30' }), buchung({ von:'19:00', bis:'20:00' })), true);
});
test('ueberlappt: gleiche Zeit an anderem Tag', () => {
  assert.equal(L.ueberlappt(buchung({ datum:'2026-09-12' }), buchung({ datum:'2026-09-13' })), false);
});

test('sperreTrifft: Anlagensperre trifft jede Buchung im Zeitraum', () => {
  const sp = { art:'anlage', von:'2026-09-12T00:00', bis:'2026-09-12T23:59' };
  assert.equal(L.sperreTrifft(sp, 'p2', [], '2026-09-12', '10:00', '11:00'), true);
});
test('sperreTrifft: Platzsperre trifft nur diesen Platz', () => {
  const sp = { art:'platz', ziel:'p1', von:'2026-09-12T00:00', bis:'2026-09-12T23:59' };
  assert.equal(L.sperreTrifft(sp, 'p1', [], '2026-09-12', '10:00', '11:00'), true);
  assert.equal(L.sperreTrifft(sp, 'p2', [], '2026-09-12', '10:00', '11:00'), false);
});
test('sperreTrifft: Kabinensperre trifft nur Buchungen mit dieser Kabine', () => {
  const sp = { art:'kabine', ziel:'Gast 1', von:'2026-09-12T00:00', bis:'2026-09-12T23:59' };
  assert.equal(L.sperreTrifft(sp, 'p1', ['Heim 1', 'Gast 1'], '2026-09-12', '10:00', '11:00'), true);
  assert.equal(L.sperreTrifft(sp, 'p1', ['Heim 1'], '2026-09-12', '10:00', '11:00'), false);
});
test('sperreTrifft: Buchung, die genau am Sperrende beginnt, ist frei', () => {
  const sp = { art:'anlage', von:'2026-09-12T08:00', bis:'2026-09-12T18:00' };
  assert.equal(L.sperreTrifft(sp, 'p1', [], '2026-09-12', '18:00', '19:00'), false);
  assert.equal(L.sperreTrifft(sp, 'p1', [], '2026-09-12', '17:59', '19:00'), true);
});
test('sperrenFuerBuchung: liefert alle zutreffenden Sperren aus der übergebenen Liste', () => {
  const liste = [{ id:'x1', art:'platz', ziel:'p1', von:'2026-09-12T00:00', bis:'2026-09-12T23:59' },
                 { id:'x2', art:'platz', ziel:'p2', von:'2026-09-12T00:00', bis:'2026-09-12T23:59' }];
  assert.deepEqual(L.sperrenFuerBuchung(buchung({}), liste).map(s => s.id), ['x1']);
  assert.deepEqual(L.sperrenFuerBuchung(buchung({}), undefined), []);
});

test('hatKonflikt: gleicher Platz, überlappende Zeit', () => {
  const liste = [buchung({ id:'b2', von:'19:00', bis:'20:00', kabinen:[] })];
  assert.equal(L.hatKonflikt(buchung({}), liste), true);
});
test('hatKonflikt: anderer Platz, aber gemeinsame Kabine', () => {
  const liste = [buchung({ id:'b2', platzId:'p2', von:'19:00', bis:'20:00', kabinen:['Heim 1'] })];
  assert.equal(L.hatKonflikt(buchung({}), liste), true);
});
test('hatKonflikt: abgelehnte Buchungen und die Buchung selbst zählen nicht', () => {
  const liste = [buchung({ id:'b2', status:'abgelehnt' }), buchung({ id:'b1' })];
  assert.equal(L.hatKonflikt(buchung({}), liste), false);
});

test('serienTermine: wöchentlich an zwei Wochentagen', () => {
  const s = { periode:'woechentlich', wochentage:[0, 2], start:'2026-09-07', ende:null };
  assert.deepEqual(L.serienTermine(s, '2026-09-20'), ['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16']);
});
test('serienTermine: alle zwei Wochen über den Jahreswechsel', () => {
  const s = { periode:'zweiwoechentlich', wochentage:[0], start:'2026-12-21', ende:null };
  assert.deepEqual(L.serienTermine(s, '2027-01-31'), ['2026-12-21', '2027-01-04', '2027-01-18']);
});
test('serienTermine: monatlich am fünften Freitag überspringt Monate ohne fünften Freitag', () => {
  const s = { periode:'monatlich', wochentage:[4], start:'2026-01-30', woche:5, ende:null };
  assert.deepEqual(L.serienTermine(s, '2026-07-31'), ['2026-01-30', '2026-05-29', '2026-07-31']);
});
test('serienTermine: Woche im Monat ergibt sich aus dem Startdatum, wenn nicht angegeben', () => {
  const s = { periode:'monatlich', wochentage:[1], start:'2026-09-08', ende:null };   // zweiter Dienstag
  assert.deepEqual(L.serienTermine(s, '2026-11-30'), ['2026-09-08', '2026-10-13', '2026-11-10']);
});
test('serienTermine: wöchentlich über die Zeitumstellung hinweg', () => {
  const s = { periode:'woechentlich', wochentage:[6], start:'2026-03-22', ende:null };
  assert.deepEqual(L.serienTermine(s, '2026-04-05'), ['2026-03-22', '2026-03-29', '2026-04-05']);
});
test('serienTermine: Serienende begrenzt, Ende vor Start ergibt nichts', () => {
  const s = { periode:'woechentlich', wochentage:[0], start:'2026-09-07', ende:'2026-09-14' };
  assert.deepEqual(L.serienTermine(s, '2026-12-31'), ['2026-09-07', '2026-09-14']);
  assert.deepEqual(L.serienTermine({ ...s, ende:'2026-09-01' }, '2026-12-31'), []);
});

function serie(o) {
  return Object.assign({ id:'s1', periode:'woechentlich', wochentage:[0], start:'2026-09-07', ende:null, horizont:'', status:'angefragt',
    erstelltVon:'trainer', vorlage:{ platzId:'p1', von:'18:00', bis:'19:30', typ:'Training', mannschaft:'1. Mannschaft', kabinen:['Heim 1'], notiz:'' } }, o);
}
test('legeSerienTermineAn: legt Termine an, lässt gesperrte aus, markiert Überschneidungen', () => {
  const st = { buchungen:[buchung({ id:'alt', datum:'2026-09-21', von:'18:30', bis:'19:00', kabinen:[] })],
               sperren:[{ id:'x1', art:'platz', ziel:'p1', von:'2026-09-14T00:00', bis:'2026-09-14T23:59' }] };
  const s = serie({});
  const erg = L.legeSerienTermineAn(st, s, '2026-09-06', '2026-09-28');
  assert.deepEqual(erg, { angelegt:3, konflikte:1, gesperrt:1 });
  const neue = st.buchungen.filter(b => b.serieId === 's1').map(b => b.datum).sort();
  assert.deepEqual(neue, ['2026-09-07', '2026-09-21', '2026-09-28']);
  assert.equal(st.buchungen.find(b => b.serieId === 's1' && b.datum === '2026-09-21').konflikt, true);
  assert.equal(s.horizont, '2026-09-28');
});
test('legeSerienTermineAn: vorhandene Termine der Serie werden nicht doppelt angelegt', () => {
  const st = { buchungen:[], sperren:[] };
  const s = serie({});
  L.legeSerienTermineAn(st, s, '2026-09-06', '2026-09-14');
  const erg = L.legeSerienTermineAn(st, s, '2026-09-06', '2026-09-21');
  assert.equal(erg.angelegt, 1);
  assert.equal(st.buchungen.length, 3);
});

test('normalisiere: hebt einen Datenstand der Version 1 auf das aktuelle Modell', () => {
  const alt = { version:1,
    config:{ plaetze:[{ id:'p1', name:'Platz 1', verantwortlicher:'X' }], kabinen:['Heim 1'], mannschaften:['A'], trainer:['T'] },
    buchungen:[{ id:'b1', platzId:'p1', datum:'2026-07-13', von:'18:00', bis:'19:30', typ:'Training', mannschaft:'A', trainer:'T', kabine:'Heim 1', notiz:'' }] };
  const d = L.normalisiere(alt);
  assert.equal(d.version, 2);
  assert.equal(d.config.trainer, undefined);
  assert.equal(d.config.plaetze[0].verantwortlicher, undefined);
  assert.ok(d.config.kabinen.includes(L.SCHIRI));
  const b = d.buchungen[0];
  assert.deepEqual(b.kabinen, ['Heim 1']);
  assert.equal('kabine' in b, false);
  assert.equal('trainer' in b, false);
  assert.equal(b.status, 'genehmigt');
  assert.equal(b.erstelltVon, 'leitung');
  assert.deepEqual(d.serien, []);
  assert.deepEqual(d.sperren, []);
});
test('normalisiere: entfernt Namensfelder auch aus Serienvorlagen und akzeptiert leere Eingaben', () => {
  const d = L.normalisiere({ version:2, serien:[{ id:'s1', vorlage:{ trainer:'T', kabinen:['Heim 1'] }, wochentage:[0] }] });
  assert.equal('trainer' in d.serien[0].vorlage, false);
  assert.equal(d.serien[0].status, 'genehmigt');
  assert.deepEqual(L.normalisiere(null), L.STANDARD_DATEN);
});

test('Datumshilfen', () => {
  assert.equal(L.deDatum('2026-09-05'), '05.09.2026');
  assert.equal(L.datumPlus('2026-02-28', 1), '2026-03-01');
  assert.equal(L.monatePlus('2026-09-05', 6), '2027-03-05');
  assert.equal(L.wochentagIndex('2026-09-07'), 0);   // Montag
  assert.equal(L.isoDatum(L.montagVon(new Date('2026-09-10T12:00'))), '2026-09-07');
  assert.equal(L.kalenderwoche(new Date(2026, 0, 1, 12)), 1);
  assert.equal(L.kalenderwoche(new Date(2026, 11, 31, 12)), 53);
});
