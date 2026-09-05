/* Fachlogik der Platzbelegung: Datenmodell, Datumsrechnung, Serientermine, Sperren, Konflikte.
   Ohne Oberfläche und ohne Zugriff auf den Seitenzustand, damit sie unter Node testbar ist (node --test).
   Im Browser werden die Funktionen als globale Namen bereitgestellt, in Node als module.exports. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const SCHIRI = 'Schiedsrichter';
const HORIZONT_MONATE = 6;          // so weit im Voraus werden fortlaufende Serien angelegt
const VERLAENGERN_AB_MONATE = 2;    // Serien werden verlängert, sobald der Horizont näher rückt
const STATUS_TEXT = { genehmigt:'Genehmigt', angefragt:'Reserviert · Freigabe offen', abgelehnt:'Abgelehnt' };
const PERIODEN = { woechentlich:'Wöchentlich', zweiwoechentlich:'Alle 2 Wochen', monatlich:'Monatlich' };
const TAGE = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
const TAGE_KURZ = ['Mo','Di','Mi','Do','Fr','Sa','So'];
const STANDARD_DATEN = {
  version: 2,
  config: {
    vereinsname: "FC Tegernheim",
    plaetze: [
      { id:"p1", name:"Platz 1" },
      { id:"p2", name:"Platz 2" },
      { id:"p3", name:"Platz Am Damm" },
      { id:"p4", name:"Kleinfeld" }
    ],
    kabinen: ["Heim 1","Heim 2","Gast 1","Gast 2",SCHIRI],
    mannschaften: ["1. Mannschaft","2. Mannschaft","Damen","A-Jugend","B-Jugend","AH"]
  },
  buchungen: [],
  serien: [],
  sperren: []
};
function montagVon(d){ d = new Date(d); const t = (d.getDay()+6)%7; d.setDate(d.getDate()-t); d.setHours(0,0,0,0); return d; }
function isoDatum(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function deDatum(iso){ const [j,m,t] = iso.split('-'); return t+'.'+m+'.'+j; }
function deZeitpunkt(dt){ const [d,t] = String(dt).split('T'); return deDatum(d)+(t?' '+t:''); }
function wochentagIndex(iso){ return (new Date(iso+'T12:00').getDay()+6)%7; }
function datumPlus(iso, tage){ const d = new Date(iso+'T12:00'); d.setDate(d.getDate()+tage); return isoDatum(d); }
function monatePlus(iso, n){ const d = new Date(iso+'T12:00'); d.setMonth(d.getMonth()+n); return isoDatum(d); }
function jetztIso(){ return new Date().toISOString().slice(0,16); }
function neueId(){ return 'b'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function ueberlappt(a,b){ return a.datum===b.datum && a.von < b.bis && b.von < a.bis; }
function nachDatum(a,b){ return a.datum===b.datum ? a.von.localeCompare(b.von) : a.datum.localeCompare(b.datum); }
// Bringt jeden Datenstand (auch Version 1) auf das aktuelle Modell. Es wird nichts gelöscht:
// alte Buchungen gelten als genehmigt, "kabine" wird zur Liste "kabinen".
function normalisiere(d){
  const basis = JSON.parse(JSON.stringify(STANDARD_DATEN));
  if (!d || typeof d !== 'object') return basis;
  const altVersion = d.version || 1;
  d.config = Object.assign(basis.config, d.config || {});
  ['plaetze','kabinen','mannschaften'].forEach(f => { if (!Array.isArray(d.config[f])) d.config[f] = basis.config[f]; });
  // Datenschutz: die data.json ist öffentlich – Personennamen (Trainerliste, Platzverantwortliche, Trainer je Buchung)
  // werden aus alten Datenständen entfernt und nicht mehr gespeichert. Ansprechpartner stehen verschlüsselt in "kontakte".
  delete d.config.trainer;
  d.config.plaetze.forEach(p => { delete p.verantwortlicher; });
  if (altVersion < 2 && !d.config.kabinen.includes(SCHIRI)) d.config.kabinen.push(SCHIRI);
  d.buchungen = Array.isArray(d.buchungen) ? d.buchungen : [];
  d.buchungen.forEach(b => {
    if (!Array.isArray(b.kabinen)) b.kabinen = b.kabine ? [b.kabine] : [];
    delete b.kabine; delete b.trainer;
    if (!STATUS_TEXT[b.status]) b.status = 'genehmigt';
    if (!b.erstelltVon) b.erstelltVon = 'leitung';
  });
  d.serien = Array.isArray(d.serien) ? d.serien : [];
  d.serien.forEach(s => { if (!s.vorlage) s.vorlage = {}; delete s.vorlage.trainer; if (!Array.isArray(s.vorlage.kabinen)) s.vorlage.kabinen = []; if (!Array.isArray(s.wochentage)) s.wochentage = []; if (!STATUS_TEXT[s.status]) s.status = 'genehmigt'; });
  d.sperren = Array.isArray(d.sperren) ? d.sperren : [];
  ['zugang','zugangLeitung','kontakte'].forEach(k => { if (d[k] && typeof d[k] !== 'object') delete d[k]; });
  d.version = 2;
  return d;
}
function sperreTrifft(sp, platzId, kabinen, datum, von, bis){
  const a = datum+'T'+von, e = datum+'T'+bis;
  if (!(sp.von < e && a < sp.bis)) return false;
  if (sp.art==='anlage') return true;
  if (sp.art==='platz') return sp.ziel===platzId;
  if (sp.art==='kabine') return (kabinen||[]).includes(sp.ziel);
  return false;
}
function sperrenFuerBuchung(b, liste){ return (liste||[]).filter(sp => sperreTrifft(sp, b.platzId, b.kabinen, b.datum, b.von, b.bis)); }
// Liefert alle Termine einer Serie bis einschließlich bisDatum (und höchstens bis zum Serienende)
function serienTermine(serie, bisDatum){
  const ende = serie.ende && serie.ende < bisDatum ? serie.ende : bisDatum;
  const tage = [];
  if (!serie.wochentage.length || ende < serie.start) return tage;
  if (serie.periode==='monatlich'){
    // n-ter Wochentag im Monat, n ergibt sich aus dem Startdatum
    const n = serie.woche || Math.ceil(parseInt(serie.start.slice(8,10),10)/7);
    let d = new Date(serie.start.slice(0,7)+'-01T12:00');
    while (isoDatum(d) <= ende){
      const j = d.getFullYear(), m = d.getMonth();
      for (const w of serie.wochentage){
        const erster = new Date(j, m, 1, 12);
        const versatz = (w - ((erster.getDay()+6)%7) + 7) % 7;
        const tag = new Date(j, m, 1 + versatz + (n-1)*7, 12);
        if (tag.getMonth() !== m) continue;
        const iso = isoDatum(tag);
        if (iso >= serie.start && iso <= ende) tage.push(iso);
      }
      d = new Date(j, m+1, 1, 12);
    }
    return tage.sort();
  }
  const schritt = serie.periode==='zweiwoechentlich' ? 2 : 1;
  const basisMontag = montagVon(new Date(serie.start+'T12:00'));
  const d = new Date(serie.start+'T12:00');
  while (isoDatum(d) <= ende){
    const wt = (d.getDay()+6)%7;
    const wochen = Math.round((montagVon(d) - basisMontag) / (7*864e5));
    if (serie.wochentage.includes(wt) && wochen % schritt === 0) tage.push(isoDatum(d));
    d.setDate(d.getDate()+1);
  }
  return tage;
}
function serieText(s){
  const wt = s.wochentage.map(i=>TAGE_KURZ[i]).join('/');
  const zusatz = s.periode==='monatlich' ? ' (je '+(s.woche||1)+'. im Monat)' : '';
  return (PERIODEN[s.periode]||s.periode)+' '+wt+zusatz+', ab '+deDatum(s.start)+(s.ende ? ' bis '+deDatum(s.ende) : ', fortlaufend');
}
function hatKonflikt(b, liste){
  return liste.some(x => x.id!==b.id && x.status!=='abgelehnt' && ueberlappt(x,b)
    && (x.platzId===b.platzId || x.kabinen.some(k => b.kabinen.includes(k))));
}
// Legt für eine Serie alle Termine im Intervall (ab, bis] als Buchungen an.
// Sperren werden übersprungen (harte Sperre), Überschneidungen werden trotzdem gebucht und markiert.
function legeSerienTermineAn(st, serie, ab, bis){
  const termine = serienTermine(serie, bis).filter(t => t > ab);
  const erg = { angelegt:0, konflikte:0, gesperrt:0 };
  for (const t of termine){
    if (st.buchungen.some(b => b.serieId===serie.id && b.datum===t)) continue;
    const b = Object.assign({}, serie.vorlage, { id:neueId(), datum:t, serieId:serie.id, status:serie.status, grund:'',
      erstelltVon:serie.erstelltVon || 'leitung', geaendertAm:jetztIso(), kabinen:(serie.vorlage.kabinen||[]).slice() });
    if (sperrenFuerBuchung(b, st.sperren).length) { erg.gesperrt++; continue; }
    if (hatKonflikt(b, st.buchungen)) { b.konflikt = true; erg.konflikte++; }
    st.buchungen.push(b); erg.angelegt++;
  }
  serie.horizont = serie.ende && serie.ende < bis ? serie.ende : bis;
  return erg;
}
function kalenderwoche(d){
  d = new Date(d); d.setHours(0,0,0,0);
  d.setDate(d.getDate()+3-((d.getDay()+6)%7));
  const w1 = new Date(d.getFullYear(),0,4);
  return 1+Math.round(((d-w1)/864e5-3+((w1.getDay()+6)%7))/7);
}

return { SCHIRI, HORIZONT_MONATE, VERLAENGERN_AB_MONATE, STATUS_TEXT, PERIODEN, TAGE, TAGE_KURZ, STANDARD_DATEN, montagVon, isoDatum, deDatum, deZeitpunkt, wochentagIndex, datumPlus, monatePlus, jetztIso, neueId, ueberlappt, nachDatum, normalisiere, sperreTrifft, sperrenFuerBuchung, serienTermine, serieText, hatKonflikt, legeSerienTermineAn, kalenderwoche };
});
