/* Platzbelegung FC Tegernheim – Oberfläche, Laden/Speichern über GitHub, Zugänge und Verschlüsselung.
   Die Fachlogik (Datumsrechnung, Serien, Sperren, Konflikte, Datenmodell) steht in logik.js.
   Keine Inline-Skripte: index.html setzt eine Content-Security-Policy, Schaltflächen nutzen data-fn (siehe Ende der Datei). */
'use strict';

/* ================= Grunddaten & Zustand ================= */
const SECRET_NAMEN = ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','MAIL_VON','KONTAKT_SCHLUESSEL'];


let S = JSON.parse(JSON.stringify(STANDARD_DATEN)); // aktueller Datenstand
let ansicht = 'anlage';           // anlage | woche | liste | anfragen | sperren | stammdaten | qr | impressum | datenschutz
let wochenStart = montagVon(new Date());
let anlageTag = null;             // ISO-Datum der Anlagen-Ansicht (null = heute)
let lokalModus = false;           // kein Repo konfiguriert -> Änderungen nur auf diesem Gerät
let offlineModus = false;         // Repo konfiguriert, aber nicht erreichbar -> nur Anzeige des Zwischenspeichers
let standZeit = '';               // Uhrzeit des zuletzt geladenen Server-Stands
let speichertGerade = false;
let serienGeprueft = false;       // fortlaufende Serien nur einmal je Sitzung verlängern
let sperreForm = { art:'platz' };
let secretNamenCache = null;

/* ================= Hilfen ================= */
const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function utf8b64(str){ return btoa(unescape(encodeURIComponent(str))); }
function b64utf8(str){ return decodeURIComponent(escape(atob(str))); }
function platzName(id){ const p = S.config.plaetze.find(p=>p.id===id); return p ? p.name : '?'; }

function toast(text){
  document.querySelectorAll('.toast').forEach(e=>e.remove());
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

/* ================= Rollen & Anmeldung (localStorage) ================= */
// Rollen: '' (nur Ansicht) | 'trainer' (buchen = Anfrage) | 'leitung' (Vollzugriff)
function holeToken(){ return localStorage.getItem('fct_token') || ''; }
function rolle(){ return holeToken() ? (localStorage.getItem('fct_rolle')==='leitung' ? 'leitung' : 'trainer') : ''; }
function istEditModus(){ return !!rolle(); }
function istLeitung(){ return rolle()==='leitung'; }
function holeGeheim(){ try { return JSON.parse(localStorage.getItem('fct_geheim')||'{}') || {}; } catch(e){ return {}; } }
function setzeGeheim(g){ localStorage.setItem('fct_geheim', JSON.stringify(g||{})); }
function setzeAnmeldung(token, r, geheim){
  localStorage.setItem('fct_token', token);
  localStorage.setItem('fct_rolle', r);
  setzeGeheim(Object.assign({}, geheim||{}, { token }));
}
function loescheAnmeldung(){ ['fct_token','fct_rolle','fct_geheim'].forEach(k=>localStorage.removeItem(k)); }

// Auf GitHub Pages werden Besitzer und Repo automatisch aus der URL erkannt.
function ermittleRepo(){
  const h = location.hostname, teil = location.pathname.split('/').filter(Boolean);
  if (h.endsWith('.github.io') && teil.length) return h.split('.')[0] + '/' + teil[0];
  return localStorage.getItem('fct_repo') || '';
}

// QR-Codes: #pw=<base64 Passwort> meldet an (Rolle ergibt sich aus dem Passwort); #k=<base64 Token> = Leitung (alt)
let anmeldungAusUrl = null;
(function zugangAusUrl(){
  const mk = location.hash.match(/[#&]k=([^&]+)/);
  const mp = location.hash.match(/[#&]pw=([^&]+)/);
  if (mk) { try { setzeAnmeldung(b64utf8(decodeURIComponent(mk[1])), 'leitung'); } catch(e){} }
  if (mp) { try { anmeldungAusUrl = b64utf8(decodeURIComponent(mp[1])); } catch(e){} }
  if (mk || mp) history.replaceState(null, '', location.pathname + location.search);
})();

/* ================= Laden & Speichern (GitHub) ================= */
function uebernehmeServerStand(daten){
  S = normalisiere(daten);
  standZeit = new Date().toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });
  localStorage.setItem('fct_cache', JSON.stringify(S));
  localStorage.setItem('fct_cache_zeit', standZeit);
  offlineModus = false;
}
async function ladeDaten(){
  const repo = ermittleRepo();
  lokalModus = !repo;
  if (repo) {
    // Ansicht ohne Anmeldung auf GitHub Pages: die Datei direkt von der Seite laden.
    // Das unterliegt keiner Anfragebegrenzung (die GitHub-API erlaubt anonym nur 60 Aufrufe je Stunde und IP-Adresse).
    if (!holeToken() && location.hostname.endsWith('.github.io')) {
      try {
        const antwort = await fetch('data.json?t='+Date.now(), { cache:'no-store' });
        if (antwort.ok) { uebernehmeServerStand(await antwort.json()); return; }
      } catch(e){ /* weiter mit API */ }
    }
    try {
      const kopf = { 'Accept':'application/vnd.github.raw+json' };
      if (holeToken()) kopf['Authorization'] = 'Bearer ' + holeToken();
      const antwort = await fetch('https://api.github.com/repos/'+repo+'/contents/data.json?t='+Date.now(), { headers: kopf });
      if (antwort.ok) { uebernehmeServerStand(await antwort.json()); return; }
    } catch(e){ /* Repo nicht erreichbar */ }
    // Repo konfiguriert, aber nicht erreichbar: letzter bekannter Server-Stand, nur zur Anzeige
    const cache = localStorage.getItem('fct_cache');
    if (cache) { try { S = normalisiere(JSON.parse(cache)); } catch(e){} }
    standZeit = localStorage.getItem('fct_cache_zeit') || '';
    offlineModus = true;
    return;
  }
  // Lokaler Modus (kein Repo): eigene Änderungen haben Vorrang vor der mitgelieferten data.json
  offlineModus = false;
  const lokal = localStorage.getItem('fct_lokal');
  if (lokal) { try { S = normalisiere(JSON.parse(lokal)); return; } catch(e){} }
  try {
    const antwort = await fetch('data.json?t='+Date.now());
    if (antwort.ok) S = normalisiere(await antwort.json());
  } catch(e){}
}


function rollenPrefix(){ return istLeitung() ? '[leitung] ' : '[trainer] '; }

// Jede Änderung wird als Mutation auf den frischesten Server-Stand angewendet,
// damit parallele Buchungen anderer nicht überschrieben werden.
async function speichere(mutation, meldung){
  if (lokalModus) {
    mutation(S); render();
    localStorage.setItem('fct_lokal', JSON.stringify(S));
    toast('Lokal gespeichert (kein Repo verbunden)');
    return true;
  }
  if (!holeToken()) { toast('⚠ Nicht angemeldet – Änderung nicht gespeichert'); return false; }
  const vorher = JSON.stringify(S);
  mutation(S); render();                      // sofort anzeigen (optimistisch), bei Fehler wieder zurücknehmen
  speichertGerade = true; render();
  const repo = ermittleRepo();
  try {
    for (let versuch = 0; versuch < 2; versuch++) {
      const meta = await fetch('https://api.github.com/repos/'+repo+'/contents/data.json?t='+Date.now(), {
        headers: { 'Authorization':'Bearer '+holeToken(), 'Accept':'application/vnd.github+json' }
      });
      if (!meta.ok) throw new Error('Lesen fehlgeschlagen ('+meta.status+')');
      const info = await meta.json();
      const server = normalisiere(JSON.parse(b64utf8(info.content.replace(/\n/g,''))));
      mutation(server);                        // Mutation auf Server-Stand anwenden
      const put = await fetch('https://api.github.com/repos/'+repo+'/contents/data.json', {
        method: 'PUT',
        headers: { 'Authorization':'Bearer '+holeToken(), 'Accept':'application/vnd.github+json' },
        body: JSON.stringify({ message: rollenPrefix()+meldung, content: utf8b64(JSON.stringify(server, null, 2)), sha: info.sha })
      });
      if (put.ok) {
        S = server;
        standZeit = new Date().toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });
        localStorage.setItem('fct_cache', JSON.stringify(S));
        localStorage.setItem('fct_cache_zeit', standZeit);
        offlineModus = false;
        speichertGerade = false; render();
        toast('Gespeichert ✓');
        return true;
      }
      if (put.status !== 409 && put.status !== 422) throw new Error('Speichern fehlgeschlagen ('+put.status+')');
      // bei Konflikt: Schleife holt frischen Stand und versucht es erneut
    }
    throw new Error('Konflikt beim Speichern – bitte erneut versuchen');
  } catch (e) {
    // Nichts gespeichert: angezeigten Stand zurücknehmen, damit keine ungesicherte Buchung als gespeichert erscheint
    try { S = normalisiere(JSON.parse(vorher)); } catch(x){}
    const netz = e instanceof TypeError;
    if (netz) offlineModus = true;
    speichertGerade = false; render();
    toast('⚠ Nicht gespeichert: ' + (netz ? 'keine Verbindung zu GitHub' : e.message));
    return false;
  }
}

/* ================= Sperren ================= */
function inSperre(b){ return sperrenFuerBuchung(b, S.sperren).length > 0; }
// Alle Sperren, die an einem Tag einen Platz bzw. eine Kabine (oder die Anlage) betreffen
function sperrenAmTag(iso, art, ziel){
  return S.sperren.filter(sp => sp.von < iso+'T24:00' && iso+'T00:00' < sp.bis && (sp.art==='anlage' || (sp.art===art && sp.ziel===ziel)));
}
function sperreZiel(sp){ return sp.art==='anlage' ? 'Gesamte Anlage' : sp.art==='platz' ? platzName(sp.ziel) : 'Kabine '+sp.ziel; }
function sperreText(sp){ return (sp.grund || 'Gesperrt')+' · '+deZeitpunkt(sp.von)+' bis '+deZeitpunkt(sp.bis); }

/* ================= Serientermine ================= */
// Fortlaufende Serien (ohne Enddatum) werden regelmäßig bis zum Horizont verlängert
async function verlaengereSerien(){
  if (serienGeprueft || !istEditModus()) return;
  serienGeprueft = true;
  const heute = isoDatum(new Date());
  const schwelle = monatePlus(heute, VERLAENGERN_AB_MONATE);
  if (!S.serien.some(s => !s.ende && (s.horizont||'') < schwelle)) return;
  const neuerHorizont = monatePlus(heute, HORIZONT_MONATE);
  await speichere(st => {
    st.serien.filter(s => !s.ende && (s.horizont||'') < schwelle)
      .forEach(s => legeSerienTermineAn(st, s, s.horizont || datumPlus(s.start,-1), neuerHorizont));
  }, 'Serientermine verlängert bis '+deDatum(neuerHorizont));
}

/* ================= Navigation & Rendering ================= */
function sichtbareBuchungen(){ return S.buchungen.filter(b => b.status!=='abgelehnt' || istEditModus()); }

function render(){
  // Kopf
  const badge = $('#modusBadge');
  if (speichertGerade) { badge.textContent = 'Speichert …'; badge.className = 'modus edit'; }
  else if (istLeitung()) { badge.textContent = '★ Abteilungsleitung'; badge.className = 'modus leitung'; }
  else if (istEditModus()) { badge.textContent = '✎ Trainer'; badge.className = 'modus edit'; }
  else { badge.textContent = 'Nur Ansicht'; badge.className = 'modus'; }

  const nurLeitung = ['anfragen','sperren','stammdaten'];
  if (nurLeitung.includes(ansicht) && !istLeitung()) ansicht = 'anlage';

  const punkte = [['anlage','Anlage'],['woche','Wochenplan'],['liste','Liste']];
  if (istLeitung()) {
    const offen = S.buchungen.filter(b=>b.status==='angefragt').length;
    punkte.push(['anfragen','Anfragen'+(offen?' ('+offen+')':'')]);
    punkte.push(['sperren','Sperren']);
    punkte.push(['stammdaten','Stammdaten']);
  }
  punkte.push(['qr', istLeitung() ? 'QR & Zugang' : (istEditModus() ? 'Zugang' : 'Anmelden')]);
  $('#hauptNav').innerHTML = punkte.map(([id,name]) =>
    '<button class="'+(ansicht===id?'aktiv':'')+'" data-fn="wechsle" data-args="[&quot;'+id+'&quot;]">'+name+'</button>').join('');

  // Banner
  let banner = '';
  if (lokalModus) banner = '<div class="offline">Lokaler Modus – kein GitHub-Repo verbunden. Änderungen werden nur auf diesem Gerät gespeichert.</div>';
  else if (offlineModus) banner = '<div class="offline">Keine Verbindung zu GitHub. Angezeigt wird der zuletzt geladene Stand'+(standZeit ? ' von '+esc(standZeit)+' Uhr' : '')+'. Speichern ist derzeit nicht möglich.</div>';
  $('#banner').innerHTML = banner;

  $('#fab').style.display = (istEditModus() && (ansicht==='anlage'||ansicht==='woche'||ansicht==='liste')) ? '' : 'none';

  if (ansicht==='anlage') renderAnlage();
  else if (ansicht==='woche') renderWoche();
  else if (ansicht==='liste') renderListe();
  else if (ansicht==='anfragen') renderAnfragen();
  else if (ansicht==='sperren') renderSperren();
  else if (ansicht==='stammdaten') renderStammdaten();
  else if (ansicht==='qr') renderQr();
  else if (ansicht==='impressum' || ansicht==='datenschutz') renderRechtliches(ansicht);
}
function wechsle(z){ ansicht = z; render(); window.scrollTo({top:0}); }

function ampelLegende(){
  return '<div class="ampel"><span class="a-gruen">Genehmigt</span><span class="a-orange">Reserviert · Freigabe offen</span>'
    + '<span class="a-rot">Gesperrt</span>'+(istEditModus() ? '<span class="a-grau">Abgelehnt</span>' : '')+'</div>';
}

/* ---------- Anlage: grafische Platz- und Kabinenübersicht ---------- */
function aktuelleUhrzeit(){
  const j = new Date();
  return String(j.getHours()).padStart(2,'0')+':'+String(j.getMinutes()).padStart(2,'0');
}

function renderAnlage(){
  const iso = anlageTag || isoDatum(new Date());
  const heute = isoDatum(new Date());
  const d = new Date(iso+'T12:00');
  const jetzt = aktuelleUhrzeit();
  const alle = sichtbareBuchungen();

  let html = '<div class="wochennav">'
    + '<button class="pfeil" data-fn="schiebeTag" data-args="[-1]">‹</button>'
    + '<h2>'+TAGE[(d.getDay()+6)%7]+', '+deDatum(iso)+(iso===heute?' · Heute':'')+'</h2>'
    + '<button class="pfeil" data-fn="schiebeTag" data-args="[1]">›</button>'
    + '<button class="heute-btn" data-fn="anlageHeute">Heute</button></div>'
    + ampelLegende();

  html += '<div class="anlage-raster">';
  for (const platz of S.config.plaetze){
    const bs = alle.filter(b=>b.datum===iso && b.platzId===platz.id).sort((a,b)=>a.von.localeCompare(b.von));
    const aktiv = iso===heute ? bs.find(b=>b.von<=jetzt && jetzt<b.bis && b.status!=='abgelehnt') : null;
    const sperren = sperrenAmTag(iso, 'platz', platz.id);
    const klein = platz.id==='p4';

    let status, statusKlasse='';
    if (sperren.length) { status = '⛔ Gesperrt'; statusKlasse=' gesperrt'; }
    else if (aktiv) { status = 'Jetzt: '+esc(aktiv.mannschaft)+' bis '+esc(aktiv.bis); statusKlasse=' belegt'; }
    else if (bs.length) { status = bs.length+' Belegung'+(bs.length>1?'en':''); }
    else { status = 'frei'; }

    html += '<div class="platz-karte'+(aktiv?' aktiv-jetzt':'')+(sperren.length?' gesperrt':'')+'">'
      + '<div class="platz-kopf"><div><div class="pk-name">'+esc(platz.name)+'</div>'
      + '</div><span class="pk-status'+statusKlasse+'">'+status+'</span>'
      + (istEditModus() && !sperren.length ? '<button class="plus" title="Buchung anlegen" data-fn="oeffneBuchung" data-args="[null,&quot;'+platz.id+'&quot;,&quot;'+iso+'&quot;]">+</button>' : '')
      + '</div><div class="pitch-wrap">'+rasenSvg(klein)+'<div class="pitch-overlay">';

    for (const sp of sperren) html += '<div class="sperr-schild">⛔ GESPERRT<small>'+esc(sperreText(sp))+'</small></div>';
    if (!bs.length && !sperren.length) html += '<span class="frei-schild">FREI</span>';
    const maxChips = (klein ? 2 : 3) - (sperren.length ? 1 : 0);
    for (const b of bs.slice(0, maxChips)) html += buchungsChip(b);
    if (bs.length > maxChips)
      html += '<span class="mehr" data-fn="wechsle" data-args="[&quot;woche&quot;]">+ '+(bs.length-maxChips)+' weitere</span>';

    html += '</div></div></div>';
  }
  html += '</div>';

  // Kabinentrakt
  html += '<div class="kabinen-trakt"><div class="kt-titel">🚪 Kabinentrakt<span class="dach"></span></div><div class="kabinen-reihe">';
  for (const kabine of S.config.kabinen){
    const kbs = alle.filter(b=>b.datum===iso && b.kabinen.includes(kabine) && b.status!=='abgelehnt').sort((a,b)=>a.von.localeCompare(b.von));
    const kAktiv = iso===heute ? kbs.find(b=>b.von<=jetzt && jetzt<b.bis) : null;
    const sperren = sperrenAmTag(iso, 'kabine', kabine);
    html += '<div class="kabine'+(kAktiv?' jetzt':'')+(sperren.length?' gesperrt':'')+'">'
      + tuerSvg(!!kbs.length, !!kAktiv || !!sperren.length)
      + '<div class="kb-name">'+esc(kabine)+'</div><div class="kb-info">';
    for (const sp of sperren) html += '<span class="kb-sperre">⛔ gesperrt'+(sp.grund?': '+esc(sp.grund):'')+'</span>';
    if (!kbs.length && !sperren.length) html += 'frei';
    for (const b of kbs) html += '<span class="kb-belegung"><b>'+esc(b.von)+'–'+esc(b.bis)+'</b> '+esc(b.mannschaft)+(b.status==='angefragt'?' <span style="color:var(--orange-dunkel)">(reserviert)</span>':'')+'</span>';
    html += '</div></div>';
  }
  html += '</div></div>';

  $('#app').innerHTML = html;
}

// Fußballplatz als SVG (klein = Kleinfeld mit reduzierten Markierungen)
function rasenSvg(klein){
  const B = 360, H = klein ? 170 : 240, r = 14;             // Außenmaß und Linienabstand
  const iB = B-2*r, iH = H-2*r;
  let s = '<svg class="rasen" viewBox="0 0 '+B+' '+H+'" preserveAspectRatio="xMidYMid slice">'
    + '<rect width="'+B+'" height="'+H+'" fill="#2f8f46"/>';
  for (let i=0;i<6;i++) s += '<rect x="'+(i*60)+'" width="30" height="'+H+'" fill="rgba(255,255,255,.055)"/>';
  const L = ' fill="none" stroke="rgba(255,255,255,.85)" stroke-width="2.5"';
  s += '<rect x="'+r+'" y="'+r+'" width="'+iB+'" height="'+iH+'"'+L+'/>'
    +  '<line x1="'+(B/2)+'" y1="'+r+'" x2="'+(B/2)+'" y2="'+(H-r)+'"'+L+'/>'
    +  '<circle cx="'+(B/2)+'" cy="'+(H/2)+'" r="'+(klein?20:28)+'"'+L+'/>'
    +  '<circle cx="'+(B/2)+'" cy="'+(H/2)+'" r="3" fill="rgba(255,255,255,.85)"/>';
  if (klein) {
    const bH = 74, bB = 34, bY = (H-bH)/2;
    s += '<rect x="'+r+'" y="'+bY+'" width="'+bB+'" height="'+bH+'"'+L+'/>'
      +  '<rect x="'+(B-r-bB)+'" y="'+bY+'" width="'+bB+'" height="'+bH+'"'+L+'/>';
  } else {
    const sH = 110, sB = 52, sY = (H-sH)/2, tH = 54, tB = 20, tY = (H-tH)/2;
    s += '<rect x="'+r+'" y="'+sY+'" width="'+sB+'" height="'+sH+'"'+L+'/>'
      +  '<rect x="'+r+'" y="'+tY+'" width="'+tB+'" height="'+tH+'"'+L+'/>'
      +  '<circle cx="'+(r+38)+'" cy="'+(H/2)+'" r="2.5" fill="rgba(255,255,255,.85)"/>'
      +  '<rect x="'+(B-r-sB)+'" y="'+sY+'" width="'+sB+'" height="'+sH+'"'+L+'/>'
      +  '<rect x="'+(B-r-tB)+'" y="'+tY+'" width="'+tB+'" height="'+tH+'"'+L+'/>'
      +  '<circle cx="'+(B-r-38)+'" cy="'+(H/2)+'" r="2.5" fill="rgba(255,255,255,.85)"/>';
  }
  return s + '</svg>';
}

// Kabinentür als SVG: rot = gerade belegt oder gesperrt, dunkel = heute belegt, grau = frei
function tuerSvg(belegt, jetzt){
  const farbe = jetzt ? 'var(--rot)' : (belegt ? '#3a4149' : '#c6ccd2');
  return '<svg viewBox="0 0 60 90">'
    + '<rect x="2" y="2" width="56" height="86" rx="5" fill="#eef0f2"/>'
    + '<rect x="8" y="8" width="44" height="78" rx="3" fill="'+farbe+'"/>'
    + '<circle cx="44" cy="48" r="3.5" fill="#fff"/>'
    + '</svg>';
}

function schiebeTag(n){
  const d = new Date((anlageTag || isoDatum(new Date()))+'T12:00');
  d.setDate(d.getDate()+n);
  anlageTag = isoDatum(d);
  render();
}
function anlageHeute(){ anlageTag = null; render(); }

/* ---------- Wochenplan ---------- */
function renderWoche(){
  const heute = isoDatum(new Date());
  const ende = new Date(wochenStart); ende.setDate(ende.getDate()+6);
  const kw = kalenderwoche(wochenStart);
  const alle = sichtbareBuchungen();
  let html = '<div class="wochennav">'
    + '<button class="pfeil" data-fn="schiebeWoche" data-args="[-1]">‹</button>'
    + '<h2>KW '+kw+' · '+deDatum(isoDatum(wochenStart)).slice(0,6)+' – '+deDatum(isoDatum(ende))+'</h2>'
    + '<button class="pfeil" data-fn="schiebeWoche" data-args="[1]">›</button>'
    + '<button class="heute-btn" data-fn="geheHeute">Heute</button></div>'
    + ampelLegende() + '<div class="plan">';

  for (let i=0;i<7;i++){
    const d = new Date(wochenStart); d.setDate(d.getDate()+i);
    const iso = isoDatum(d);
    const istHeute = iso===heute;
    html += '<div class="tag-block'+(istHeute?' heute':'')+'"><div class="tag-kopf">'
      + '<span class="tagname">'+TAGE[i]+'</span><span class="tagdatum">'+deDatum(iso)+'</span>'
      + (istHeute?'<span class="heute-tag">HEUTE</span>':'')+'</div><div class="platz-zeilen">';
    for (const platz of S.config.plaetze){
      const bs = alle.filter(b=>b.datum===iso && b.platzId===platz.id).sort((a,b)=>a.von.localeCompare(b.von));
      const sperren = sperrenAmTag(iso, 'platz', platz.id);
      html += '<div class="platz-zelle"><div class="platzname">'+platzIcon()+esc(platz.name)
        + (istEditModus() && !sperren.length ? '<button class="plus" title="Buchung anlegen" data-fn="oeffneBuchung" data-args="[null,&quot;'+platz.id+'&quot;,&quot;'+iso+'&quot;]">+</button>' : '')
        + '</div>';
      for (const sp of sperren) html += '<div class="sperre-banner">⛔ '+esc(sperreText(sp))+'</div>';
      if (!bs.length && !sperren.length) html += '<div class="leer">frei</div>';
      for (const b of bs) html += buchungsChip(b);
      html += '</div>';
    }
    html += '</div></div>';
  }
  $('#app').innerHTML = html + '</div>';
}

// Kleines Spielfeld-Symbol für Überschriften und Listen
function platzIcon(){
  return '<svg class="platz-icon" viewBox="0 0 36 24"><rect width="36" height="24" rx="3" fill="#2f8f46"/>'
    + '<g fill="none" stroke="#fff" stroke-width="1.6" opacity=".9">'
    + '<rect x="3" y="3" width="30" height="18"/><line x1="18" y1="3" x2="18" y2="21"/>'
    + '<circle cx="18" cy="12" r="3.6"/></g></svg>';
}
function tuerMini(){
  return '<svg width="8" height="12" viewBox="0 0 8 12"><rect x="0.6" y="0.6" width="6.8" height="10.8" rx="1.2" '
    + 'fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.4" cy="6" r="1" fill="currentColor"/></svg>';
}
function kabinenTag(kabine){ return '<span class="kabine-tag">'+tuerMini()+esc(kabine)+'</span>'; }
function kabinenTags(liste){ return liste.map(kabinenTag).join(''); }
function tuerGross(){
  return '<svg class="tuer-gross" viewBox="0 0 60 90">'
    + '<rect x="2" y="2" width="56" height="86" rx="5" fill="#fff" stroke="#c6ccd2" stroke-width="2"/>'
    + '<rect x="9" y="9" width="42" height="76" rx="3" fill="#3a4149"/>'
    + '<circle cx="43" cy="47" r="4" fill="#fff"/></svg>';
}

function statusZeile(b, ausfuehrlich){
  if (inSperre(b)) return '<div class="status-zeile sperre">⛔ Platz oder Kabine gesperrt'+(ausfuehrlich ? ': '+sperrenFuerBuchung(b, S.sperren).map(sp=>esc(sperreText(sp))).join(' · ') : '')+'</div>';
  if (b.status==='angefragt') return '<div class="status-zeile angefragt">● Reserviert · Freigabe der Abteilungsleitung offen</div>';
  if (b.status==='abgelehnt') return '<div class="status-zeile abgelehnt">✕ Abgelehnt'+(b.grund ? ': '+esc(b.grund) : '')+'</div>';
  return ausfuehrlich ? '<div class="status-zeile genehmigt">✓ Genehmigt</div>' : '';
}

function buchungsChip(b){
  const kl = (b.typ==='Training' ? ' training' : '') + (b.status==='angefragt' ? ' angefragt' : b.status==='abgelehnt' ? ' abgelehnt' : '')
    + (inSperre(b) ? ' in-sperre' : '');
  return '<div class="buchung'+kl+'" data-fn="oeffneBuchung" data-args="[&quot;'+b.id+'&quot;]">'
    + '<div class="zeile1"><span class="ampel-punkt"></span><span class="zeit">'+esc(b.von)+'–'+esc(b.bis)+'</span>'
    + (b.serieId ? '<span class="serie-symbol" title="Serientermin">↻</span>' : '')
    + (b.konflikt ? '<span class="serie-symbol" title="Überschneidung">⚠</span>' : '')
    + '<span class="typ">'+(b.typ==='Training'?'TRAINING':'SPIEL')+'</span></div>'
    + '<div class="zeile2"><b>'+esc(b.mannschaft)+'</b></div>'
    + (b.kabinen.length===1 ? '<div class="kabine-zeile">'+tuerGross()+'<span class="kabine-box">'+esc(b.kabinen[0])+'</span></div>'
      : b.kabinen.length>1 ? '<div class="kabine-zeile">'+tuerGross()+'<span class="kab-pills">'+kabinenTags(b.kabinen)+'</span></div>' : '')
    + statusZeile(b)
    + '</div>';
}

function schiebeWoche(n){ wochenStart.setDate(wochenStart.getDate()+7*n); render(); }
function geheHeute(){ wochenStart = montagVon(new Date()); render(); }

/* ---------- Liste ---------- */
function renderListe(){
  const heute = isoDatum(new Date());
  const eintraege = sichtbareBuchungen().filter(b=>b.datum>=heute).map(b => ({ datum:b.datum, von:b.von, buchung:b }));
  // Sperren tageweise einreihen (ab heute, höchstens 60 Tage je Sperre)
  for (const sp of S.sperren){
    let tag = sp.von.slice(0,10) < heute ? heute : sp.von.slice(0,10);
    const letzter = sp.bis.slice(0,10);
    for (let i=0; i<60 && tag<=letzter; i++){ eintraege.push({ datum:tag, von:'', sperre:sp }); tag = datumPlus(tag,1); }
  }
  eintraege.sort(nachDatum);
  let html = '<div class="wochennav"><h2>Kommende Belegungen</h2></div>'+ampelLegende();
  if (!eintraege.length) html += '<div class="karte"><div class="hinweis" style="margin:0">Keine kommenden Buchungen.</div></div>';
  let letztesDatum = '';
  for (const e of eintraege){
    if (e.datum!==letztesDatum){
      html += '<div class="liste-datum">'+TAGE[wochentagIndex(e.datum)]+', '+deDatum(e.datum)+'</div>';
      letztesDatum = e.datum;
    }
    if (e.sperre){
      const sp = e.sperre;
      html += '<div class="liste-karte sperre"><div class="lz">⛔ '+esc(sp.von.slice(11))+'–'+esc(sp.bis.slice(11))+'</div>'
        + '<div class="lm"><b>Gesperrt: '+esc(sperreZiel(sp))+'</b><div class="klein">'+esc(sp.grund||'')+(sp.von.slice(0,10)!==sp.bis.slice(0,10)?' · '+esc(deZeitpunkt(sp.von))+' bis '+esc(deZeitpunkt(sp.bis)):'')+'</div></div></div>';
      continue;
    }
    const b = e.buchung;
    html += '<div class="liste-karte'+(b.typ==='Training'?' training':'')+(b.status==='angefragt'?' angefragt':'')+(b.status==='abgelehnt'?' abgelehnt':'')+'" data-fn="oeffneBuchung" data-args="[&quot;'+b.id+'&quot;]">'
      + '<div class="lz">'+esc(b.von)+'–'+esc(b.bis)+'</div>'
      + '<div class="lm"><b>'+esc(b.mannschaft)+'</b> · '+(b.typ==='Training'?'Training':'Spiel')+(b.serieId?' ↻':'')
      + '<div class="klein" style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:3px">'
      + platzIcon()+'<span>'+esc(platzName(b.platzId))+'</span>'
      + kabinenTags(b.kabinen)+'</div>'
      + statusZeile(b) + '</div></div>';
  }
  $('#app').innerHTML = html;
}

/* ---------- Buchungs-Formular ---------- */
function oeffneBuchung(id, platzId, datum){
  if (!istEditModus() && !id) return;
  const b = id ? S.buchungen.find(x=>x.id===id) : null;
  if (id && !b) return;
  const nurLesen = !!id && !istEditModus();
  const leitung = istLeitung();
  const neuAnlage = !id;
  const v = b || { id:'', platzId: platzId||S.config.plaetze[0].id, datum: datum||isoDatum(new Date()),
    von:'18:00', bis:'19:30', typ:'Training', mannschaft:S.config.mannschaften[0]||'', kabinen:[], notiz:'',
    status: leitung ? 'genehmigt' : 'angefragt', grund:'' };
  const serie = v.serieId ? S.serien.find(s=>s.id===v.serieId) : null;

  let hinweis = '';
  if (nurLesen) hinweis = 'Zum Bearbeiten wird der Trainer- oder Leitungszugang benötigt.';
  else if (!leitung && neuAnlage) hinweis = 'Die Buchung wird als Reservierung eingetragen und von der Abteilungsleitung freigegeben.';
  else if (!leitung && v.status==='genehmigt') hinweis = 'Änderungen an einer genehmigten Buchung müssen erneut freigegeben werden.';

  const hg = document.createElement('div');
  hg.className = 'modal-hg';
  hg.innerHTML = '<div class="modal">'
    + '<h2>'+(nurLesen?'Buchung':(id?'Buchung bearbeiten':'Neue Buchung'))+'</h2>'
    + (hinweis ? '<div class="hinweis" style="font-size:12.5px;color:var(--grau)">'+hinweis+'</div>' : '')
    + (id ? '<div class="status-info">'+statusZeile(v, true)+'</div>' : '')
    + (serie ? '<div class="serie-info">↻ Serientermin · '+esc(serieText(serie))+'</div>' : '')
    + '<label>Art</label><div class="segment" id="fTypSeg">'
    +   '<button type="button" data-typ="Spiel" class="'+(v.typ==='Spiel'?'aktiv':'')+'">Spiel</button>'
    +   '<button type="button" data-typ="Training" class="'+(v.typ==='Training'?'aktiv training':'')+'">Training</button></div>'
    + '<label>Platz</label><select id="fPlatz">'
    +   S.config.plaetze.map(p=>'<option value="'+p.id+'"'+(p.id===v.platzId?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>'
    + '<label>Datum</label><input type="date" id="fDatum" value="'+esc(v.datum)+'">'
    + '<div class="zeit-reihe"><div><label>Von</label><input type="time" id="fVon" step="300" value="'+esc(v.von)+'"></div>'
    +   '<div><label>Bis</label><input type="time" id="fBis" step="300" value="'+esc(v.bis)+'"></div></div>'
    + '<label>Mannschaft</label><select id="fMannschaft">'
    +   S.config.mannschaften.map(m=>'<option'+(m===v.mannschaft?' selected':'')+'>'+esc(m)+'</option>').join('')
    +   (v.mannschaft && !S.config.mannschaften.includes(v.mannschaft) ? '<option selected>'+esc(v.mannschaft)+'</option>' : '')+'</select>'
    + '<label>Kabinen (mehrere möglich)</label><div class="checks" id="fKabinen">'
    +   S.config.kabinen.map(k=>'<label class="check'+(v.kabinen.includes(k)?' an':'')+'"><input type="checkbox" value="'+esc(k)+'"'+(v.kabinen.includes(k)?' checked':'')+'>'+esc(k)+'</label>').join('')
    +   v.kabinen.filter(k=>!S.config.kabinen.includes(k)).map(k=>'<label class="check an"><input type="checkbox" value="'+esc(k)+'" checked>'+esc(k)+'</label>').join('')+'</div>'
    + '<label>Notiz (optional)</label><input id="fNotiz" value="'+esc(v.notiz||'')+'" placeholder="z. B. Gegnerverein, Besonderheiten">'
    + (nurLesen ? '' : '<div class="hinweis" style="margin:4px 0 0">Bitte keine Namen oder Kontaktdaten eintragen – der Belegungsplan ist öffentlich einsehbar.</div>')
    + (leitung && !nurLesen ? '<label>Status (Ampel)</label><div class="segment" id="fStatusSeg">'
        + '<button type="button" data-status="genehmigt" class="'+(v.status==='genehmigt'?'aktiv gruen':'')+'">Genehmigt</button>'
        + '<button type="button" data-status="angefragt" class="'+(v.status==='angefragt'?'aktiv orange':'')+'">Reserviert</button>'
        + '<button type="button" data-status="abgelehnt" class="'+(v.status==='abgelehnt'?'aktiv grau':'')+'">Abgelehnt</button></div>'
        + '<div id="fGrundWrap"'+(v.status==='abgelehnt'?'':' hidden')+'><label>Begründung (wird der Mannschaft mitgeteilt · öffentlich sichtbar, keine Namen)</label><input id="fGrund" value="'+esc(v.grund||'')+'"></div>' : '')
    + (neuAnlage ? '<div class="block"><label class="kopf"><input type="checkbox" id="fSerie"> ↻ Wiederholen (Serientermin)</label>'
        + '<div id="fSerieDetails" hidden>'
        + '<label>Wochentage</label><div class="wtage" id="fWtage">'+TAGE_KURZ.map((t,i)=>'<button type="button" data-wt="'+i+'" class="'+(i===wochentagIndex(v.datum)?'an':'')+'">'+t+'</button>').join('')+'</div>'
        + '<label>Rhythmus</label><select id="fPeriode">'+Object.entries(PERIODEN).map(([k,n])=>'<option value="'+k+'">'+n+'</option>').join('')+'</select>'
        + '<div class="hinweis" id="fPeriodeHinweis" style="margin:4px 0 0"></div>'
        + '<label>Ende (optional)</label><input type="date" id="fEnde">'
        + '<div class="hinweis" style="margin:4px 0 0">Ohne Enddatum läuft die Serie fortlaufend und wird automatisch '+HORIZONT_MONATE+' Monate im Voraus angelegt. Termine in gesperrten Zeiten werden ausgelassen, Überschneidungen trotzdem gebucht und der Abteilungsleitung gemeldet.</div>'
        + '</div></div>' : '')
    + (serie && !nurLesen ? '<div class="block"><div class="kopf-text">↻ Änderung oder Löschen gilt für</div><div class="radio-zeile">'
        + '<label><input type="radio" name="fUmfang" value="einzeln" checked> Nur diesen Termin</label>'
        + '<label><input type="radio" name="fUmfang" value="folgende"> Diesen und alle folgenden</label></div></div>' : '')
    + '<div id="fWarnung"></div>'
    + '<div class="m-fuss">'
    +   (nurLesen ? '<button class="btn zweit" data-akt="zu">Schließen</button>'
      : (id?'<button class="btn gefahr" data-akt="loeschen">Löschen</button>':'')
        + '<button class="btn zweit" data-akt="zu">Abbrechen</button>'
        + '<button class="btn" data-akt="speichern">Speichern</button>')
    + '</div></div>';
  document.body.appendChild(hg);

  let typ = v.typ, statusWahl = v.status, kabinenManuell = !neuAnlage;
  const q = s => hg.querySelector(s);

  const setzeKabinen = liste => hg.querySelectorAll('#fKabinen input').forEach(i => { i.checked = liste.includes(i.value); i.parentElement.classList.toggle('an', i.checked); });
  // Bei Spielen: freie Heim- und Gastkabine plus Schiedsrichterkabine vorbelegen
  const vorbelegeKabinen = () => {
    if (kabinenManuell) return;
    if (typ!=='Spiel') { setzeKabinen([]); return; }
    const datumW = q('#fDatum').value, vonW = q('#fVon').value, bisW = q('#fBis').value;
    const belegt = new Set();
    S.buchungen.forEach(x => { if (x.id!==id && x.status!=='abgelehnt' && x.datum===datumW && x.von<bisW && vonW<x.bis) x.kabinen.forEach(k=>belegt.add(k)); });
    const wahl = [];
    const heim = S.config.kabinen.find(k=>/^heim/i.test(k) && !belegt.has(k)) || S.config.kabinen.find(k=>/^heim/i.test(k));
    const gast = S.config.kabinen.find(k=>/^gast/i.test(k) && !belegt.has(k)) || S.config.kabinen.find(k=>/^gast/i.test(k));
    if (heim) wahl.push(heim); if (gast) wahl.push(gast);
    if (S.config.kabinen.includes(SCHIRI)) wahl.push(SCHIRI);
    setzeKabinen(wahl);
  };
  const periodeHinweis = () => {
    const el = q('#fPeriodeHinweis'); if (!el) return;
    const d = q('#fDatum').value || v.datum;
    el.textContent = q('#fPeriode').value==='monatlich'
      ? 'Monatlich jeweils am '+Math.ceil(parseInt(d.slice(8,10),10)/7)+'. gewählten Wochentag des Monats (abgeleitet vom Startdatum).' : '';
  };

  hg.querySelectorAll('#fTypSeg button').forEach(btn => btn.onclick = () => {
    typ = btn.dataset.typ;
    hg.querySelectorAll('#fTypSeg button').forEach(x=>x.className = x.dataset.typ===typ ? ('aktiv'+(typ==='Training'?' training':'')) : '');
    vorbelegeKabinen();
  });
  hg.querySelectorAll('#fKabinen input').forEach(i => i.onchange = () => { kabinenManuell = true; i.parentElement.classList.toggle('an', i.checked); });
  ['#fDatum','#fVon','#fBis'].forEach(s => q(s).onchange = () => { vorbelegeKabinen(); periodeHinweis(); });
  hg.querySelectorAll('#fStatusSeg button').forEach(btn => btn.onclick = () => {
    statusWahl = btn.dataset.status;
    hg.querySelectorAll('#fStatusSeg button').forEach(x=>x.className = x.dataset.status===statusWahl ? 'aktiv '+({genehmigt:'gruen',angefragt:'orange',abgelehnt:'grau'}[statusWahl]) : '');
    q('#fGrundWrap').hidden = statusWahl!=='abgelehnt';
  });
  if (q('#fSerie')) {
    q('#fSerie').onchange = () => { q('#fSerieDetails').hidden = !q('#fSerie').checked; periodeHinweis(); };
    hg.querySelectorAll('#fWtage button').forEach(btn => btn.onclick = () => btn.classList.toggle('an'));
    q('#fPeriode').onchange = periodeHinweis;
  }
  if (neuAnlage && typ==='Spiel') vorbelegeKabinen();
  if (nurLesen) hg.querySelectorAll('input,select,#fTypSeg button').forEach(e=>e.disabled=true);

  hg.addEventListener('click', async ev => {
    if (ev.target===hg) { hg.remove(); return; }
    const akt = ev.target.dataset && ev.target.dataset.akt;
    if (!akt) return;
    if (akt==='zu') { hg.remove(); return; }
    const umfang = serie ? ((hg.querySelector('input[name=fUmfang]:checked')||{}).value || 'einzeln') : 'einzeln';

    if (akt==='loeschen') {
      if (!confirm(umfang==='folgende' ? 'Diesen und alle folgenden Termine der Serie löschen?' : 'Diese Buchung wirklich löschen?')) return;
      hg.remove();
      speichere(st => {
        if (umfang==='folgende') {
          st.buchungen = st.buchungen.filter(x => !(x.serieId===serie.id && x.datum>=v.datum));
          const s = st.serien.find(x=>x.id===serie.id);
          if (s) { s.ende = datumPlus(v.datum,-1); s.horizont = s.ende; if (s.ende < s.start) st.serien = st.serien.filter(x=>x.id!==s.id); }
        } else st.buchungen = st.buchungen.filter(x=>x.id!==id);
      }, 'Buchung gelöscht: '+v.mannschaft+' '+v.datum+' '+v.von+(umfang==='folgende'?' (Serie ab hier)':''));
      return;
    }

    if (akt==='speichern') {
      const kabinen = [...hg.querySelectorAll('#fKabinen input:checked')].map(i=>i.value);
      const neu = {
        id: id || neueId(),
        platzId: q('#fPlatz').value, datum: q('#fDatum').value, von: q('#fVon').value, bis: q('#fBis').value,
        typ, mannschaft: q('#fMannschaft').value, kabinen, notiz: q('#fNotiz').value.trim(),
        status: v.status, grund: v.grund || '', erstelltVon: v.erstelltVon || rolle(), geaendertAm: jetztIso()
      };
      if (v.serieId) neu.serieId = v.serieId;
      const felder = ['platzId','datum','von','bis','typ','mannschaft','notiz'];
      const inhaltGeaendert = neuAnlage || felder.some(f => String(v[f]||'') !== String(neu[f]||'')) || v.kabinen.join('|') !== kabinen.join('|');
      if (leitung) { neu.status = statusWahl; neu.grund = statusWahl==='abgelehnt' ? (q('#fGrund').value||'').trim() : ''; }
      else if (neuAnlage || inhaltGeaendert) { neu.status = 'angefragt'; neu.grund = ''; }

      if (!neu.datum || !neu.von || !neu.bis) { warnungAnzeigen(hg,'Bitte Datum und Uhrzeiten angeben.'); return; }
      if (neu.bis <= neu.von) { warnungAnzeigen(hg,'„Bis" muss nach „Von" liegen.'); return; }

      // Harte Sperre: keine Buchung in gesperrten Zeiten
      const sperren = sperrenFuerBuchung(neu, S.sperren);
      if (sperren.length && neu.status!=='abgelehnt') { warnungAnzeigen(hg, '⛔ Gesperrt: '+sperren.map(sperreText).join(' · ')+' — Buchung in diesem Zeitraum nicht möglich.', true); return; }

      // Überschneidungen: Warnung, zweiter Klick bucht trotzdem (wird markiert und der Leitung gemeldet)
      const andere = S.buchungen.filter(x=>x.id!==neu.id && x.status!=='abgelehnt');
      const platzKonflikt = andere.find(x=>x.platzId===neu.platzId && ueberlappt(x,neu));
      const kabinenKonflikte = neu.kabinen.map(k=>[k, andere.find(x=>x.kabinen.includes(k) && ueberlappt(x,neu))]).filter(p=>p[1]);
      const serieAn = neuAnlage && q('#fSerie') && q('#fSerie').checked;
      if ((platzKonflikt || kabinenKonflikte.length) && !hg.dataset.bestaetigt && !serieAn && neu.status!=='abgelehnt') {
        const txt = [];
        if (platzKonflikt) txt.push('Platz belegt: '+platzKonflikt.mannschaft+' '+platzKonflikt.von+'–'+platzKonflikt.bis);
        kabinenKonflikte.forEach(([k,x]) => txt.push('Kabine „'+k+'" belegt: '+x.mannschaft+' '+x.von+'–'+x.bis));
        warnungAnzeigen(hg, '⚠ '+txt.join(' · ')+' — nochmal „Speichern" drücken, um trotzdem zu buchen. Die Abteilungsleitung wird informiert.');
        hg.dataset.bestaetigt = '1';
        return;
      }
      neu.konflikt = !!(platzKonflikt || kabinenKonflikte.length) && neu.status!=='abgelehnt';

      // Serie anlegen
      if (serieAn) {
        const wochentage = [...hg.querySelectorAll('#fWtage button.an')].map(x=>+x.dataset.wt);
        if (!wochentage.length) { warnungAnzeigen(hg,'Bitte mindestens einen Wochentag wählen.'); return; }
        const ende = q('#fEnde').value || null;
        if (ende && ende < neu.datum) { warnungAnzeigen(hg,'Das Ende muss nach dem Startdatum liegen.'); return; }
        const periode = q('#fPeriode').value;
        const serieNeu = { id:'s'+neueId().slice(1), periode, wochentage, start:neu.datum, ende, horizont:'', status:neu.status,
          erstelltVon: rolle(), woche: periode==='monatlich' ? Math.ceil(parseInt(neu.datum.slice(8,10),10)/7) : undefined,
          vorlage: { platzId:neu.platzId, von:neu.von, bis:neu.bis, typ:neu.typ, mannschaft:neu.mannschaft, kabinen:neu.kabinen.slice(), notiz:neu.notiz } };
        const heute = isoDatum(new Date());
        const bis = ende || [monatePlus(heute, HORIZONT_MONATE), monatePlus(neu.datum, 1)].sort().pop();
        let erg = null;
        hg.remove();
        speichere(st => {
          const s = JSON.parse(JSON.stringify(serieNeu));
          st.serien.push(s);
          erg = legeSerienTermineAn(st, s, datumPlus(s.start,-1), bis);
        }, 'Serie angelegt: '+neu.mannschaft+' '+neu.typ+' '+serieText(serieNeu)+' '+neu.von+'–'+neu.bis)
        .then(ok => { if (ok && erg) toast(erg.angelegt+' Termine angelegt'+(erg.konflikte?', '+erg.konflikte+' mit Überschneidung':'')+(erg.gesperrt?', '+erg.gesperrt+' wegen Sperre ausgelassen':'')); });
        return;
      }

      hg.remove();
      let uebersprungen = 0;
      speichere(st => {
        if (umfang==='folgende') {
          const s = st.serien.find(x=>x.id===serie.id);
          st.buchungen.filter(x => x.serieId===serie.id && x.datum>=v.datum && x.id!==neu.id).forEach(x => {
            const kandidat = Object.assign({}, x, { platzId:neu.platzId, von:neu.von, bis:neu.bis, typ:neu.typ, mannschaft:neu.mannschaft,
              kabinen:neu.kabinen.slice(), notiz:neu.notiz, status:neu.status, grund:neu.grund, geaendertAm:neu.geaendertAm });
            if (sperrenFuerBuchung(kandidat, st.sperren).length && neu.status!=='abgelehnt') { uebersprungen++; return; }
            Object.assign(x, kandidat);
            x.konflikt = neu.status!=='abgelehnt' && hatKonflikt(x, st.buchungen);
          });
          if (s) { Object.assign(s.vorlage, { platzId:neu.platzId, von:neu.von, bis:neu.bis, typ:neu.typ, mannschaft:neu.mannschaft, kabinen:neu.kabinen.slice(), notiz:neu.notiz }); if (leitung) s.status = neu.status; }
        }
        st.buchungen = st.buchungen.filter(x=>x.id!==neu.id);
        st.buchungen.push(neu);
      }, (id?'Buchung geändert: ':'Buchung: ')+neu.mannschaft+' '+neu.datum+' '+neu.von+(umfang==='folgende'?' (Serie ab hier)':''))
      .then(ok => { if (ok && uebersprungen) toast(uebersprungen+' Termin'+(uebersprungen>1?'e':'')+' wegen Sperre unverändert gelassen'); });
    }
  });
}
function warnungAnzeigen(hg, text, hart){ hg.querySelector('#fWarnung').innerHTML = '<div class="warnung'+(hart?' hart':'')+'">'+esc(text)+'</div>'; }

/* ---------- Anfragen & Konflikte (nur Leitung) ---------- */
function buchungKurz(b){
  return TAGE[wochentagIndex(b.datum)]+', '+deDatum(b.datum)+' · '+esc(b.von)+'–'+esc(b.bis)+' · '+esc(platzName(b.platzId))
    + (b.kabinen.length ? ' · '+b.kabinen.map(esc).join(', ') : '') + (b.notiz ? ' · '+esc(b.notiz) : '');
}
function renderAnfragen(){
  const heute = isoDatum(new Date());
  const offen = S.buchungen.filter(b=>b.status==='angefragt').sort(nachDatum);
  const gruppen = []; const proSerie = new Map();
  offen.forEach(b => {
    if (b.serieId) {
      if (!proSerie.has(b.serieId)) { const g = { serie:S.serien.find(s=>s.id===b.serieId), buchungen:[] }; proSerie.set(b.serieId, g); gruppen.push(g); }
      proSerie.get(b.serieId).buchungen.push(b);
    } else gruppen.push({ buchungen:[b] });
  });

  let html = '<div class="wochennav"><h2>Anfragen &amp; Konflikte</h2></div>';
  html += '<div class="karte"><h3><span class="punkt" style="background:var(--orange)"></span>Offene Anfragen ('+offen.length+')</h3>'
    + '<div class="hinweis">Reservierungen der Trainer. Genehmigen schaltet sie auf Grün, Ablehnen informiert die Mannschaft mit Begründung.</div>';
  if (!gruppen.length) html += '<div class="hinweis" style="margin:0">Keine offenen Anfragen.</div>';
  for (const g of gruppen){
    const b = g.buchungen[0], n = g.buchungen.length, ids = g.buchungen.map(x=>x.id).join(',');
    const konf = g.buchungen.filter(x=>x.konflikt).length;
    html += '<div class="anfrage-karte"><div class="ak-text">'
      + '<b>'+esc(b.mannschaft)+'</b> · '+(b.typ==='Training'?'Training':'Spiel')+(n>1?' · ↻ Serie':'')
      + '<div class="ak-klein">'+(n>1
          ? esc(g.serie ? serieText(g.serie) : 'Serie')+' · '+n+' Termine, '+deDatum(g.buchungen[0].datum)+' bis '+deDatum(g.buchungen[n-1].datum)+' · '+esc(b.von)+'–'+esc(b.bis)+' · '+esc(platzName(b.platzId))+(b.kabinen.length?' · '+b.kabinen.map(esc).join(', '):'')
          : buchungKurz(b))+'</div>'
      + (konf ? '<div class="ak-klein" style="color:var(--orange-dunkel);font-weight:700">⚠ '+konf+' Termin'+(konf>1?'e':'')+' mit Überschneidung</div>' : '')
      + '</div><div class="ak-knoepfe">'
      + '<button class="btn klein gruen" data-fn="entscheide" data-args="[&quot;'+ids+'&quot;,&quot;genehmigt&quot;,'+(n>1)+']">✓ Genehmigen</button>'
      + '<button class="btn klein gefahr" data-fn="entscheide" data-args="[&quot;'+ids+'&quot;,&quot;abgelehnt&quot;,'+(n>1)+']">✕ Ablehnen</button>'
      + '<button class="btn klein zweit" data-fn="oeffneBuchung" data-args="[&quot;'+b.id+'&quot;]">Öffnen</button></div></div>';
  }
  html += '</div>';

  const konflikte = S.buchungen.filter(b=>b.konflikt && b.status!=='abgelehnt' && b.datum>=heute).sort(nachDatum);
  html += '<div class="karte"><h3><span class="punkt"></span>Überschneidungen ('+konflikte.length+')</h3>'
    + '<div class="hinweis">Buchungen, die trotz belegtem Platz oder belegter Kabine eingetragen wurden.</div>';
  if (!konflikte.length) html += '<div class="hinweis" style="margin:0">Keine Überschneidungen.</div>';
  for (const b of konflikte){
    const andere = S.buchungen.filter(x => x.id!==b.id && x.status!=='abgelehnt' && ueberlappt(x,b) && (x.platzId===b.platzId || x.kabinen.some(k=>b.kabinen.includes(k))));
    html += '<div class="anfrage-karte"><div class="ak-text"><b>'+esc(b.mannschaft)+'</b> · '+(b.typ==='Training'?'Training':'Spiel')+(b.serieId?' ↻':'')
      + '<div class="ak-klein">'+buchungKurz(b)+'</div>'
      + '<div class="ak-klein">Überschneidet sich mit: '+andere.map(x=>esc(x.mannschaft)+' '+esc(x.von)+'–'+esc(x.bis)+(x.platzId===b.platzId?' (Platz)':' (Kabine)')).join(', ')+'</div>'
      + '</div><div class="ak-knoepfe">'
      + '<button class="btn klein zweit" data-fn="oeffneBuchung" data-args="[&quot;'+b.id+'&quot;]">Öffnen</button>'
      + '<button class="btn klein zweit" data-fn="konfliktGeklaert" data-args="[&quot;'+b.id+'&quot;]">Geklärt</button></div></div>';
  }
  html += '</div>';

  const betroffen = S.buchungen.filter(b=>b.status!=='abgelehnt' && b.datum>=heute && inSperre(b)).sort(nachDatum);
  html += '<div class="karte"><h3><span class="punkt"></span>Von Sperren betroffen ('+betroffen.length+')</h3>'
    + '<div class="hinweis">Bestehende Buchungen, die in eine Sperre fallen. Sie bleiben stehen, bis sie verschoben oder gelöscht werden.</div>';
  if (!betroffen.length) html += '<div class="hinweis" style="margin:0">Keine betroffenen Buchungen.</div>';
  for (const b of betroffen){
    html += '<div class="anfrage-karte"><div class="ak-text"><b>'+esc(b.mannschaft)+'</b> · '+(b.typ==='Training'?'Training':'Spiel')
      + '<div class="ak-klein">'+buchungKurz(b)+'</div>'
      + '<div class="ak-klein" style="color:var(--rot)">⛔ '+sperrenFuerBuchung(b, S.sperren).map(sp=>esc(sperreZiel(sp)+': '+sperreText(sp))).join(' · ')+'</div>'
      + '</div><div class="ak-knoepfe"><button class="btn klein zweit" data-fn="oeffneBuchung" data-args="[&quot;'+b.id+'&quot;]">Öffnen</button></div></div>';
  }
  html += '</div>';
  $('#app').innerHTML = html;
}
function entscheide(ids, status, ganzeSerie){
  const liste = ids.split(',');
  let grund = '';
  if (status==='abgelehnt') {
    grund = prompt('Begründung für die Ablehnung (wird der Mannschaft mitgeteilt):', '');
    if (grund===null) return;
    grund = grund.trim();
  }
  const erste = S.buchungen.find(b=>b.id===liste[0]) || {};
  speichere(st => {
    liste.forEach(id => { const b = st.buchungen.find(x=>x.id===id); if (b) { b.status = status; b.grund = grund; b.geaendertAm = jetztIso(); } });
    if (ganzeSerie && erste.serieId) { const s = st.serien.find(x=>x.id===erste.serieId); if (s) s.status = status; }
  }, (status==='genehmigt' ? 'Genehmigt: ' : 'Abgelehnt: ')+(erste.mannschaft||'')+' '+(liste.length>1 ? liste.length+' Termine' : (erste.datum||'')+' '+(erste.von||''))+(grund?' ('+grund+')':''));
}
function konfliktGeklaert(id){
  const b = S.buchungen.find(x=>x.id===id); if (!b) return;
  speichere(st => { const x = st.buchungen.find(y=>y.id===id); if (x) delete x.konflikt; }, 'Überschneidung geklärt: '+b.mannschaft+' '+b.datum);
}

/* ---------- Sperren (nur Leitung) ---------- */
function renderSperren(){
  const heute = isoDatum(new Date());
  let html = '<div class="wochennav"><h2>Sperren</h2></div>';
  html += '<div class="karte"><h3><span class="punkt"></span>Neue Sperre</h3>'
    + '<div class="hinweis">Gesperrte Plätze, Kabinen oder die ganze Anlage können im Zeitraum nicht gebucht werden (harte Sperre). '
    + 'Bestehende Buchungen bleiben stehen, werden rot markiert und die betroffenen Mannschaften per E-Mail informiert.</div>'
    + '<label>Was wird gesperrt?</label><div class="segment" id="spArt">'
    + [['anlage','Gesamte Anlage'],['platz','Ein Platz'],['kabine','Eine Kabine']].map(([a,n])=>'<button type="button" data-art="'+a+'" class="'+(sperreForm.art===a?'aktiv':'')+'">'+n+'</button>').join('')+'</div>'
    + '<div id="spZielWrap"><label>Platz / Kabine</label><select id="spZiel"></select></div>'
    + '<div class="zeit-reihe"><div><label>Von</label><input type="date" id="spVonD" value="'+heute+'"><input type="time" id="spVonZ" value="00:00" style="margin-top:6px"></div>'
    + '<div><label>Bis</label><input type="date" id="spBisD" value="'+heute+'"><input type="time" id="spBisZ" value="23:59" style="margin-top:6px"></div></div>'
    + '<div style="margin-top:10px"><label class="check"><input type="checkbox" id="spGanz" checked> Ganztägig</label></div>'
    + '<label>Grund</label><input id="spGrund" placeholder="z. B. Platzpflege, Unwetter, Sperrung durch Gemeinde">'
    + '<div class="m-fuss" style="max-width:300px"><button class="btn" data-fn="sperreAnlegen">Sperre eintragen</button></div></div>';

  const liste = S.sperren.slice().sort((a,b)=>a.von.localeCompare(b.von));
  const aktiv = liste.filter(sp=>sp.bis >= heute+'T00:00');
  const alt = liste.filter(sp=>sp.bis < heute+'T00:00').reverse();
  html += '<div class="karte"><h3><span class="punkt"></span>Aktuelle und kommende Sperren ('+aktiv.length+')</h3>';
  if (!aktiv.length) html += '<div class="hinweis" style="margin:0">Keine Sperren eingetragen.</div>';
  html += aktiv.map(sperreZeile).join('') + '</div>';
  if (alt.length) html += '<div class="karte"><h3><span class="punkt" style="background:#b6bdc4"></span>Vergangene Sperren ('+alt.length+')</h3>'+alt.slice(0,20).map(sperreZeile).join('')+'</div>';
  $('#app').innerHTML = html;

  const fuelleZiel = () => {
    const art = sperreForm.art, sel = $('#spZiel');
    $('#spZielWrap').hidden = art==='anlage';
    sel.innerHTML = art==='platz' ? S.config.plaetze.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('')
      : art==='kabine' ? S.config.kabinen.map(k=>'<option value="'+esc(k)+'">'+esc(k)+'</option>').join('') : '';
  };
  document.querySelectorAll('#spArt button').forEach(btn => btn.onclick = () => {
    sperreForm.art = btn.dataset.art;
    document.querySelectorAll('#spArt button').forEach(x=>x.className = x.dataset.art===sperreForm.art ? 'aktiv' : '');
    fuelleZiel();
  });
  fuelleZiel();
  const zeitFelder = () => {
    const g = $('#spGanz').checked;
    $('#spVonZ').disabled = g; $('#spBisZ').disabled = g;
    if (g) { $('#spVonZ').value = '00:00'; $('#spBisZ').value = '23:59'; }
  };
  $('#spGanz').onchange = zeitFelder; zeitFelder();
}
function sperreZeile(sp){
  const betroffen = S.buchungen.filter(b=>b.status!=='abgelehnt' && sperreTrifft(sp,b.platzId,b.kabinen,b.datum,b.von,b.bis)).length;
  return '<div class="anfrage-karte"><div class="ak-text"><b>⛔ '+esc(sperreZiel(sp))+'</b>'
    + '<div class="ak-klein">'+esc(deZeitpunkt(sp.von))+' bis '+esc(deZeitpunkt(sp.bis))+(sp.grund?' · '+esc(sp.grund):'')
    + (betroffen ? ' · <b style="color:var(--rot)">'+betroffen+' Buchung'+(betroffen>1?'en':'')+' betroffen</b>' : '')+'</div></div>'
    + '<div class="ak-knoepfe"><button class="btn klein gefahr" data-fn="sperreAufheben" data-args="[&quot;'+sp.id+'&quot;]">Aufheben</button></div></div>';
}
function sperreAnlegen(){
  const art = sperreForm.art, ziel = art==='anlage' ? '' : $('#spZiel').value;
  if (!$('#spVonD').value || !$('#spBisD').value) return toast('⚠ Bitte Zeitraum angeben');
  const von = $('#spVonD').value+'T'+($('#spVonZ').value||'00:00');
  const bis = $('#spBisD').value+'T'+($('#spBisZ').value||'23:59');
  if (bis <= von) return toast('⚠ „Bis" muss nach „Von" liegen');
  if (art!=='anlage' && !ziel) return toast('⚠ Bitte Platz bzw. Kabine wählen');
  const sp = { id:'x'+neueId().slice(1), art, ziel, von, bis, grund: $('#spGrund').value.trim(), erstelltAm: jetztIso() };
  speichere(st => { st.sperren.push(sp); }, 'Sperre: '+sperreZiel(sp)+' '+deZeitpunkt(von)+' bis '+deZeitpunkt(bis)+(sp.grund?' ('+sp.grund+')':''));
}
function sperreAufheben(id){
  const sp = S.sperren.find(x=>x.id===id); if (!sp) return;
  if (!confirm('Sperre „'+sperreZiel(sp)+'" aufheben?')) return;
  speichere(st => { st.sperren = st.sperren.filter(x=>x.id!==id); }, 'Sperre aufgehoben: '+sperreZiel(sp)+' '+deZeitpunkt(sp.von));
}

/* ---------- Stammdaten (nur Leitung) ---------- */
function renderStammdaten(){
  const c = S.config;
  let html = '<div class="wochennav"><h2>Stammdaten bearbeiten</h2></div>';
  html += '<div class="karte"><h3><span class="punkt"></span>Plätze</h3>'
    + '<div class="hinweis">Name je Platz. Die vier Plätze sind fest. Aus Datenschutzgründen werden hier keine Personennamen hinterlegt – Ansprechpartner stehen verschlüsselt unter „QR &amp; Zugang“ → Kontakte.</div>';
  c.plaetze.forEach((p,i)=>{
    html += '<div class="sd-zeile">'
      + '<input value="'+esc(p.name)+'" placeholder="Platzname" data-fn-change="aenderePlatz" data-args="['+i+',&quot;name&quot;]">'
      + '</div>';
  });
  html += '</div>';
  html += listenKarte('Mannschaften', 'mannschaften', c.mannschaften, 'Liste frei erweiterbar – neue Mannschaft unten hinzufügen. Umbenennen wirkt auf alle Buchungen. Bitte Mannschaftsnamen, keine Personennamen.');
  html += listenKarte('Kabinen', 'kabinen', c.kabinen, 'Kabinen können umbenannt, ergänzt oder entfernt werden. Bei Spielen werden Heim-, Gast- und Schiedsrichterkabine automatisch vorgeschlagen.');
  $('#app').innerHTML = html;
}
function listenKarte(titel, feld, liste, hinweis){
  let html = '<div class="karte"><h3><span class="punkt"></span>'+titel+'</h3><div class="hinweis">'+hinweis+'</div>';
  liste.forEach((eintrag,i)=>{
    html += '<div class="sd-zeile"><input value="'+esc(eintrag)+'" data-fn-change="aendereListe" data-args="[&quot;'+feld+'&quot;,'+i+']">'
      + '<button class="loeschen" title="Entfernen" data-fn="entferneListe" data-args="[&quot;'+feld+'&quot;,'+i+']">✕</button></div>';
  });
  html += '<div class="hinzu"><input id="neu_'+feld+'" placeholder="Neuer Eintrag …">'
    + '<button class="btn zweit" data-fn="fuegeListeHinzu" data-args="[&quot;'+feld+'&quot;]">Hinzufügen</button></div>';
  return html + '</div>';
}
function aenderePlatz(i, feld, wert){
  speichere(st => { st.config.plaetze[i][feld] = wert.trim(); }, 'Platz aktualisiert');
}
function aendereListe(feld, i, wert){
  const alt = S.config[feld][i];
  wert = wert.trim(); if (!wert || wert===alt) return render();
  speichere(st => {
    st.config[feld][i] = wert;
    if (feld==='mannschaften') { st.buchungen.forEach(b=>{ if (b.mannschaft===alt) b.mannschaft = wert; }); st.serien.forEach(s=>{ if (s.vorlage.mannschaft===alt) s.vorlage.mannschaft = wert; }); }
    if (feld==='kabinen') {
      st.buchungen.forEach(b=>{ b.kabinen = b.kabinen.map(k=>k===alt?wert:k); });
      st.serien.forEach(s=>{ s.vorlage.kabinen = s.vorlage.kabinen.map(k=>k===alt?wert:k); });
      st.sperren.forEach(sp=>{ if (sp.art==='kabine' && sp.ziel===alt) sp.ziel = wert; });
    }
  }, titelFuer(feld)+' umbenannt: '+alt+' → '+wert);
}
function entferneListe(feld, i){
  const eintrag = S.config[feld][i];
  if (!confirm('„'+eintrag+'" aus der Liste entfernen? Bestehende Buchungen bleiben erhalten.')) return;
  speichere(st => { st.config[feld].splice(i,1); }, titelFuer(feld)+' entfernt: '+eintrag);
}
function fuegeListeHinzu(feld){
  const inp = $('#neu_'+feld); const wert = (inp.value||'').trim();
  if (!wert) return;
  if (S.config[feld].includes(wert)) { toast('Eintrag existiert bereits'); return; }
  speichere(st => { if (!st.config[feld].includes(wert)) st.config[feld].push(wert); }, titelFuer(feld)+' hinzugefügt: '+wert);
}
function titelFuer(feld){ return {mannschaften:'Mannschaft',kabinen:'Kabine'}[feld]||feld; }

/* ---------- QR-Codes, Anmeldung & Zugang ---------- */
function qrKarte(art, band, bandKlasse, titel, unter, url, warn){
  return '<div class="karte qr-karte" data-qr="'+art+'"><span class="'+bandKlasse+'">'+band+'</span>'
    + '<div class="qr-titel">'+titel+'</div><div class="qr-unter">'+unter+'</div>'
    + '<div class="qr-box">'+qrSvg(url)+'</div>'
    + (warn ? '<div class="qr-warn">'+warn+'</div>' : '<div class="url">'+esc(url)+'</div>')
    + '<div class="kein-druck" style="margin-top:10px"><button class="btn zweit klein" data-fn="druckeQr" data-args="[&quot;'+art+'&quot;]">🖨 Diesen Code drucken</button></div></div>';
}
function qrHinweisKarte(titel, text){
  return '<div class="karte qr-karte kein-druck"><span class="intern-band">NOCH NICHT VERFÜGBAR</span><div class="qr-titel">'+titel+'</div>'
    + '<div class="qr-unter" style="margin-top:14px">'+text+'</div></div>';
}
function druckeQr(art){
  document.querySelectorAll('.qr-karte').forEach(k => k.classList.toggle('druck-aus', k.dataset.qr!==art));
  const aufraeumen = () => document.querySelectorAll('.qr-karte').forEach(k => k.classList.remove('druck-aus'));
  window.addEventListener('afterprint', aufraeumen, { once:true });
  window.print();
  setTimeout(aufraeumen, 2000);
}

function renderQr(){
  const basisUrl = location.href.split('#')[0];

  // Nicht angemeldet: Passwort-Login
  if (!istEditModus()) {
    const eingerichtet = !!(S.zugang || S.zugangLeitung);
    $('#app').innerHTML = '<div class="wochennav"><h2>Anmeldung</h2></div>'
      + '<div class="karte" style="max-width:480px;margin:0 auto"><h3><span class="punkt"></span>Anmelden</h3>'
      + '<div class="hinweis">'+(eingerichtet
          ? 'Das Passwort entscheidet über die Rolle: <b>Trainer-Passwort</b> = buchen und Anfragen stellen, <b>Leitungs-Passwort</b> = Vollzugriff. Alternativ den passenden QR-Code scannen.'
          : 'Es ist noch kein Passwort eingerichtet. Der Admin meldet sich beim ersten Mal mit dem GitHub-Token an und legt danach unter „QR &amp; Zugang" die Passwörter fest.')+'</div>'
      + '<label>'+(eingerichtet ? 'Passwort' : 'Passwort oder GitHub-Token')+'</label>'
      + '<input id="ePasswort" type="password" placeholder="••••••••" data-enter="anmelden">'
      + '<div class="m-fuss" style="max-width:240px"><button class="btn" data-fn="anmelden">Anmelden</button></div></div>';
    return;
  }

  // Trainer: nur Abmelden
  if (!istLeitung()) {
    $('#app').innerHTML = '<div class="wochennav"><h2>Zugang</h2></div>'
      + '<div class="karte" style="max-width:480px;margin:0 auto"><h3><span class="punkt"></span>Angemeldet als Trainer</h3>'
      + '<div class="hinweis">Du kannst Buchungen und Serientermine anlegen. Sie erscheinen orange als Reservierung, bis die Abteilungsleitung sie freigibt. '
      + 'Änderungen an genehmigten Buchungen müssen erneut freigegeben werden.</div>'
      + '<div class="m-fuss" style="max-width:240px"><button class="btn gefahr" data-fn="abmelden">Abmelden</button></div></div>';
    return;
  }

  // Leitung: drei QR-Codes + Verwaltung
  const g = holeGeheim();
  let html = '<div class="wochennav"><h2>QR-Codes &amp; Zugang</h2></div><div class="qr-raster qr-drei">';
  html += qrKarte('ansicht', 'EIN CODE FÜR ALLE', 'extern-band', 'Platzbelegung ansehen', 'Für Aushang, Eltern, Gastvereine. Nur Ansicht.', basisUrl);
  html += g.trainerPasswort
    ? qrKarte('trainer', 'VERTRAULICH · TRAINER', 'intern-band', 'Trainer-Zugang', 'Meldet direkt als Trainer an. Nur an Trainer weitergeben.',
        basisUrl+'#pw='+encodeURIComponent(utf8b64(g.trainerPasswort)), 'Wer diesen Code hat, kann buchen. Nicht öffentlich aushängen.')
    : qrHinweisKarte('Trainer-Zugang', 'Unten ein Trainer-Passwort festlegen (oder das bestehende neu setzen), dann erscheint hier der QR-Code.');
  html += g.leitungPasswort
    ? qrKarte('leitung', 'VERTRAULICH · LEITUNG', 'intern-band', 'Leitungs-Zugang', 'Meldet direkt als Abteilungsleitung an. Nicht weitergeben.',
        basisUrl+'#pw='+encodeURIComponent(utf8b64(g.leitungPasswort)), 'Wer diesen Code hat, hat Vollzugriff. Sicher verwahren.')
    : qrHinweisKarte('Leitungs-Zugang', 'Unten das Leitungs-Passwort festlegen, dann erscheint hier der QR-Code.');
  html += '</div>';

  html += '<div class="karte kein-druck"><h3><span class="punkt"></span>Passwörter</h3>'
    + '<div class="hinweis">Zwei Passwörter, drei Rollen: ohne Passwort nur Ansicht, Trainer-Passwort = buchen und Anfragen stellen, Leitungs-Passwort = Vollzugriff. '
    + 'Beide Passwörter verschlüsseln das GitHub-Token in der data.json. Leere Felder bleiben unverändert.'
    + (S.zugangLeitung ? '' : '<br><b>Noch kein Leitungs-Passwort eingerichtet.</b>')
    + (S.zugang ? '' : '<br><b>Noch kein Trainer-Passwort eingerichtet.</b>')
    + (S.kontakte && !g.kontaktschluessel ? '<br><b>Hinweis:</b> Auf diesem Gerät ist der Kontaktschlüssel nicht bekannt (Anmeldung per Token). Ein neues Leitungs-Passwort erzeugt einen neuen Schlüssel, die Kontakte müssten danach neu eingegeben werden.' : '')+'</div>'
    + '<label>Leitungs-Passwort'+(S.zugangLeitung?' (neu setzen)':'')+'</label><input id="eLeitungPw" type="password" placeholder="mind. 8 Zeichen">'
    + '<label>Trainer-Passwort'+(S.zugang?' (neu setzen)':'')+'</label><input id="eTrainerPw" type="password" placeholder="mind. 8 Zeichen">'
    + '<div class="m-fuss" style="max-width:300px"><button class="btn" data-fn="speicherePasswoerter">Passwörter speichern</button></div></div>';

  html += '<div class="karte kein-druck"><h3><span class="punkt"></span>E-Mail-Benachrichtigungen: Postfach</h3>'
    + '<div class="hinweis">Eine GitHub Action verschickt bei Änderungen E-Mails und einmal im Monat eine Sicherung der Datendatei. Die Zugangsdaten des Absender-Postfachs werden als GitHub Secrets hinterlegt; '
    + 'sie sind danach für niemanden mehr lesbar, auch nicht hier. Das Leitungs-Token braucht dafür die Berechtigung „Secrets: Read and write“.</div>'
    + '<div id="secretStatus" class="secret-status">Prüfe Secrets …</div>'
    + '<label>SMTP-Server</label><input id="eSmtpHost" placeholder="z. B. smtp.strato.de oder smtp.gmail.com">'
    + '<div class="zeit-reihe"><div><label>Port</label><input id="eSmtpPort" value="587" placeholder="587 oder 465"></div>'
    + '<div><label>Benutzername</label><input id="eSmtpUser" placeholder="meist die E-Mail-Adresse"></div></div>'
    + '<label>Passwort</label><input id="eSmtpPass" type="password" placeholder="wird nur übertragen, wenn ausgefüllt">'
    + '<label>Absenderadresse</label><input id="eMailVon" placeholder="platzbelegung@fc-tegernheim.de">'
    + '<div class="m-fuss" style="max-width:520px"><button class="btn" data-fn="speicherePostfach">In GitHub Secrets speichern</button>'
    + '<button class="btn zweit" data-fn="testMail">Test-Mail senden</button>'
    + '<button class="btn zweit" data-fn="sicherungSenden">Sicherung jetzt senden</button></div>'
    + '<div class="hinweis" style="margin-top:8px">Die Sicherung schickt die Datendatei einmal im Monat automatisch als Anhang an die Adressen der Leitung. Bitte die Mail ablegen; sie ist die Kopie außerhalb von GitHub.</div></div>';

  html += '<div class="karte kein-druck"><h3><span class="punkt"></span>E-Mail-Benachrichtigungen: Kontakte</h3>'
    + '<div class="hinweis">Namen und E-Mail-Adressen der Ansprechpartner je Mannschaft. Mehrere Adressen mit Komma trennen. Die Kontakte werden verschlüsselt in der data.json gespeichert; nur die Abteilungsleitung und die GitHub Action können sie lesen – öffentlich sichtbar sind sie nicht. '
    + 'Die Leitung erhält Anfragen, Überschneidungen und Änderungen der Trainer. Die Mannschaften erhalten Genehmigungen, Ablehnungen, Änderungen durch die Leitung und Sperren, die ihre Buchungen betreffen.</div>'
    + (g.kontaktschluessel
      ? '<label>Abteilungsleitung</label><input id="eKontLeitung" placeholder="markus@…, stefan@…">'
        + S.config.mannschaften.map((m,i)=>'<label>'+esc(m)+'</label>'
            + '<input id="eKontName'+i+'" placeholder="Ansprechpartner / Trainer (Name, optional)" style="margin-bottom:6px">'
            + '<input id="eKont'+i+'" placeholder="E-Mail-Adressen der Verantwortlichen">').join('')
        + '<div class="m-fuss" style="max-width:300px"><button class="btn" data-fn="speichereKontakte">Kontakte speichern</button></div>'
      : '<div class="info">Zum Bearbeiten der Kontakte bitte mit dem Leitungs-Passwort anmelden (nicht per Token). Falls noch keins existiert: oben festlegen, dann neu anmelden.</div>')
    + '</div>';

  html += '<div class="karte kein-druck"><h3><span class="punkt"></span>Technik (nur Admin)</h3>'
    + '<label>GitHub-Repo (Besitzer/Name)</label>'
    + '<input id="eRepo" value="'+esc(ermittleRepo())+'" placeholder="z. B. maxmuster/fct-platzbelegung"'
    + (location.hostname.endsWith('.github.io')?' disabled':'')+'>'
    + (location.hostname.endsWith('.github.io')?'<div class="hinweis" style="margin-top:4px">Wird auf GitHub Pages automatisch erkannt.</div>':'')
    + '<label>GitHub-Token der Leitung</label>'
    + '<input id="eToken" type="password" value="'+esc(holeToken())+'" placeholder="github_pat_…">'
    + '<div class="hinweis" style="margin-top:4px">Fine-grained, nur dieses Repo, Berechtigungen: Contents (Read and write), Secrets (Read and write), Actions (Read and write).</div>'
    + '<label>GitHub-Token für Trainer (optional)</label>'
    + '<input id="eTrainerToken" type="password" value="'+esc(g.trainerToken||'')+'" placeholder="leer = Trainer nutzen dasselbe Token">'
    + '<div class="hinweis" style="margin-top:4px">Empfohlen: eigenes Token nur mit Contents (Read and write). Wird beim Speichern des Trainer-Passworts verwendet.</div>'
    + '<div class="m-fuss" style="max-width:460px">'
    + '<button class="btn zweit" data-fn="uebernehmeEinstellungen">Übernehmen</button>'
    + '<button class="btn gefahr" data-fn="abmelden">Abmelden</button></div></div>';

  $('#app').innerHTML = html;
  ladeSecretStatus();
  ladeKontakteInFormular();
}
function qrSvg(text){
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text); qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch(e){ return '<div class="hinweis">QR konnte nicht erzeugt werden</div>'; }
}

/* ---------- Anmeldung ---------- */
async function anmelden(eingabe){
  eingabe = (typeof eingabe === 'string' ? eingabe : (($('#ePasswort')||{}).value||'')).trim();
  if (!eingabe) return false;
  const krypto = !!(window.crypto && crypto.subtle);
  const fertig = async (text) => { toast(text); ansicht = 'anlage'; await ladeDaten(); serienGeprueft = false; render(); verlaengereSerien(); return true; };

  if (krypto && S.zugangLeitung) {
    try {
      const geheim = JSON.parse(await entschluessele(S.zugangLeitung, eingabe));
      if (geheim && geheim.token) { setzeAnmeldung(geheim.token, 'leitung', geheim); return fertig('Als Abteilungsleitung angemeldet ✓'); }
    } catch(e){ /* nicht das Leitungs-Passwort */ }
  }
  if (krypto && S.zugang) {
    try {
      const klar = await entschluessele(S.zugang, eingabe);
      let token = klar;
      try { const j = JSON.parse(klar); if (j && j.token) token = j.token; } catch(e){}
      setzeAnmeldung(token, 'trainer', { token });
      return fertig('Als Trainer angemeldet ✓');
    } catch(e){ /* nicht das Trainer-Passwort */ }
  }
  // Direktes Token (Admin) oder noch nichts eingerichtet: Eingabe ist das Token bzw. ein beliebiger Schlüssel (lokal)
  if (eingabe.startsWith('github_pat_') || eingabe.startsWith('ghp_') || (!S.zugang && !S.zugangLeitung)) {
    setzeAnmeldung(eingabe, 'leitung', { token: eingabe });
    return fertig('Mit Token angemeldet (Leitung) ✓');
  }
  toast('⚠ Passwort falsch');
  return false;
}
function abmelden(){
  if (!confirm('Zugang auf diesem Gerät entfernen?')) return;
  loescheAnmeldung();
  ansicht = 'anlage'; render();
}

/* ---------- Passwörter & Token ---------- */
// Schreibt die verschlüsselten Zugänge neu. Das Leitungs-Geheimnis enthält Token, Kontaktschlüssel und beide Passwörter,
// damit die Leitung die QR-Codes jederzeit erzeugen kann.
async function schreibeZugaenge(g, auchTrainer){
  const zugangLeitung = await verschluessele(JSON.stringify({ token:g.token, trainerToken:g.trainerToken||'', kontaktschluessel:g.kontaktschluessel,
    trainerPasswort:g.trainerPasswort||'', leitungPasswort:g.leitungPasswort }), g.leitungPasswort);
  const zugang = auchTrainer && g.trainerPasswort ? await verschluessele(JSON.stringify({ token: g.trainerToken || g.token }), g.trainerPasswort) : null;
  const ok = await speichere(st => { st.zugangLeitung = zugangLeitung; if (zugang) st.zugang = zugang; }, 'Zugangsdaten aktualisiert');
  if (ok) setzeGeheim(g);
  return ok;
}
async function speicherePasswoerter(){
  const pwL = ($('#eLeitungPw').value||'').trim(), pwT = ($('#eTrainerPw').value||'').trim();
  if (!holeToken()) return toast('⚠ Zuerst unten das GitHub-Token eintragen');
  if (!(window.crypto && crypto.subtle)) return toast('⚠ Verschlüsselung in diesem Browser nicht verfügbar');
  if ((pwL && pwL.length < 8) || (pwT && pwT.length < 8)) return toast('⚠ Bitte mindestens 8 Zeichen');
  const g = Object.assign({}, holeGeheim(), { token: holeToken() });
  if (pwL) g.leitungPasswort = pwL;
  if (pwT) g.trainerPasswort = pwT;
  if (!g.leitungPasswort) return toast('⚠ Bitte zuerst ein Leitungs-Passwort festlegen');
  if (g.trainerPasswort && g.trainerPasswort === g.leitungPasswort) return toast('⚠ Trainer- und Leitungs-Passwort müssen sich unterscheiden');
  if (!g.kontaktschluessel) {
    if (S.kontakte && !confirm('Auf diesem Gerät ist der Kontaktschlüssel nicht bekannt. Es wird ein neuer erzeugt, die gespeicherten Kontakte müssen danach neu eingegeben werden. Fortfahren?')) return;
    g.kontaktschluessel = zufallB64(32);
  }
  const ok = await schreibeZugaenge(g, !!pwT);
  if (ok) { toast('Passwörter gespeichert ✓'); render(); }
}
function uebernehmeEinstellungen(){
  const repoFeld = $('#eRepo');
  if (repoFeld && !repoFeld.disabled) localStorage.setItem('fct_repo', repoFeld.value.trim());
  const t = ($('#eToken').value||'').trim(), tt = ($('#eTrainerToken').value||'').trim();
  const g = holeGeheim();
  const tokenGeaendert = t && t !== g.token, trainerTokenGeaendert = tt !== (g.trainerToken||'');
  if (!t) { toast('⚠ Token darf nicht leer sein – zum Abmelden den Knopf „Abmelden“ nutzen'); return; }
  g.token = t; g.trainerToken = tt;
  setzeAnmeldung(t, 'leitung', g);
  ladeDaten().then(async () => {
    if (g.leitungPasswort && (tokenGeaendert || trainerTokenGeaendert)) {
      const ok = await schreibeZugaenge(g, trainerTokenGeaendert && !!g.trainerPasswort);
      if (ok) toast('Token übernommen und Zugänge neu verschlüsselt ✓');
    } else toast('Einstellungen übernommen');
    render();
  });
}

/* ---------- Postfach (GitHub Secrets) & Kontakte ---------- */
async function ladeSecretStatus(){
  const el = $('#secretStatus'); if (!el) return;
  if (lokalModus || offlineModus) { el.innerHTML = '<div class="fehler">Kein Repo verbunden – Secrets nur online möglich.</div>'; return; }
  try {
    const namen = await listeSecrets();
    el.innerHTML = SECRET_NAMEN.map(n => '<span class="'+(namen.includes(n)?'ok':'')+'">'+(namen.includes(n)?'✓ ':'– ')+n+'</span>').join('');
  } catch(e){ el.innerHTML = '<div class="fehler">'+esc(e.message)+'</div>'; }
}
async function speicherePostfach(){
  const felder = { SMTP_HOST:'#eSmtpHost', SMTP_PORT:'#eSmtpPort', SMTP_USER:'#eSmtpUser', SMTP_PASS:'#eSmtpPass', MAIL_VON:'#eMailVon' };
  const werte = Object.entries(felder).map(([n,s]) => [n, ($(s).value||'').trim()]).filter(([n,w]) => w);
  if (!werte.length) return toast('⚠ Bitte Felder ausfüllen');
  try {
    for (const [n,w] of werte) await setzeSecret(n, w);
    $('#eSmtpPass').value = '';
    toast(werte.length+' Secret'+(werte.length>1?'s':'')+' gespeichert ✓');
  } catch(e){ toast('⚠ '+e.message); }
  ladeSecretStatus();
}
async function starteWorkflow(datei, erfolg){
  try {
    const info = await githubApi('');
    const zweig = info.ok ? (await info.json()).default_branch : 'main';
    const r = await githubApi('/actions/workflows/'+datei+'/dispatches', { method:'POST', body: JSON.stringify({ ref: zweig }) });
    if (r.status===204) toast(erfolg);
    else if (r.status===404) toast('⚠ Workflow nicht gefunden – liegt .github/workflows/'+datei+' im Repo?');
    else if (r.status===403) toast('⚠ Token braucht die Berechtigung „Actions: Read and write“');
    else toast('⚠ Fehler '+r.status);
  } catch(e){ toast('⚠ '+e.message); }
}
function testMail(){ return starteWorkflow('benachrichtigung.yml', 'Test-Mail angestoßen – Ergebnis in ca. 1 Minute im Postfach der Leitung (Log unter GitHub → Actions)'); }
function sicherungSenden(){ return starteWorkflow('sicherung.yml', 'Sicherung angestoßen – die Datendatei geht in ca. 1 Minute als Anhang an die Leitung'); }
function liesAdressen(sel){
  const el = $(sel); if (!el) return [];
  return (el.value||'').split(/[,;\s]+/).map(a=>a.trim()).filter(a => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
}
async function ladeKontakteInFormular(){
  const g = holeGeheim();
  if (!g.kontaktschluessel || !$('#eKontLeitung')) return;
  if (!S.kontakte) return;
  try {
    const k = JSON.parse(await entschluesseleMitSchluessel(S.kontakte, g.kontaktschluessel));
    $('#eKontLeitung').value = (k.leitung||[]).join(', ');
    S.config.mannschaften.forEach((m,i) => {
      const el = $('#eKont'+i); if (el) el.value = ((k.mannschaften||{})[m]||[]).join(', ');
      const nm = $('#eKontName'+i); if (nm) nm.value = (k.namen||{})[m] || '';
    });
  } catch(e){
    const el = $('#eKontLeitung'); if (el) el.placeholder = 'Kontakte konnten nicht entschlüsselt werden (anderer Schlüssel) – bitte neu eingeben';
  }
}
async function speichereKontakte(){
  const g = holeGeheim();
  if (!g.kontaktschluessel) return toast('⚠ Bitte mit dem Leitungs-Passwort anmelden');
  const k = { leitung: liesAdressen('#eKontLeitung'), mannschaften: {}, namen: {} };
  S.config.mannschaften.forEach((m,i) => {
    const a = liesAdressen('#eKont'+i); if (a.length) k.mannschaften[m] = a;
    const nm = (($('#eKontName'+i)||{}).value||'').trim(); if (nm) k.namen[m] = nm;
  });
  const blob = await verschluesseleMitSchluessel(JSON.stringify(k), g.kontaktschluessel);
  const ok = await speichere(st => { st.kontakte = blob; }, 'Kontakte aktualisiert');
  if (!ok) return;
  if (lokalModus || offlineModus) return;
  try { await setzeSecret('KONTAKT_SCHLUESSEL', g.kontaktschluessel); toast('Kontakte gespeichert, Schlüssel an GitHub übertragen ✓'); }
  catch(e){ toast('⚠ Kontakte gespeichert, aber: '+e.message); }
  ladeSecretStatus();
}

/* ---------- Verschlüsselung (AES-GCM, Schlüssel per PBKDF2 aus dem Passwort) ---------- */
function b64zuBytes(b64){ return Uint8Array.from(atob(b64), c=>c.charCodeAt(0)); }
function bytesZuB64(puffer){
  const b = new Uint8Array(puffer); let s = '';
  for (let i=0; i<b.length; i+=4096) s += String.fromCharCode.apply(null, b.subarray(i, i+4096));
  return btoa(s);
}
function zufallB64(n){ return bytesZuB64(crypto.getRandomValues(new Uint8Array(n))); }
async function leiteSchluessel(passwort, salzB64, iterationen){
  const basis = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', salt:b64zuBytes(salzB64), iterations:iterationen, hash:'SHA-256' },
    basis, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}
async function verschluessele(text, passwort){
  const salz = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterationen = 310000;
  const schluessel = await leiteSchluessel(passwort, bytesZuB64(salz), iterationen);
  const blob = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, schluessel, new TextEncoder().encode(text));
  return { salz:bytesZuB64(salz), iv:bytesZuB64(iv), blob:bytesZuB64(blob), iterationen };
}
async function entschluessele(zugang, passwort){
  const schluessel = await leiteSchluessel(passwort, zugang.salz, zugang.iterationen);
  const klar = await crypto.subtle.decrypt({ name:'AES-GCM', iv:b64zuBytes(zugang.iv) }, schluessel, b64zuBytes(zugang.blob));
  return new TextDecoder().decode(klar);
}
// Kontakte: AES-GCM mit einem zufälligen Schlüssel, den auch die GitHub Action (als Secret) kennt
async function schluesselAusB64(b64){ return crypto.subtle.importKey('raw', b64zuBytes(b64), { name:'AES-GCM' }, false, ['encrypt','decrypt']); }
async function verschluesseleMitSchluessel(text, keyB64){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const blob = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, await schluesselAusB64(keyB64), new TextEncoder().encode(text));
  return { iv:bytesZuB64(iv), blob:bytesZuB64(blob) };
}
async function entschluesseleMitSchluessel(obj, keyB64){
  const klar = await crypto.subtle.decrypt({ name:'AES-GCM', iv:b64zuBytes(obj.iv) }, await schluesselAusB64(keyB64), b64zuBytes(obj.blob));
  return new TextDecoder().decode(klar);
}

/* ---------- GitHub Secrets (Sealed Box: X25519 + XSalsa20-Poly1305, Nonce per BLAKE2b) ---------- */
async function githubApi(pfad, opts){
  return fetch('https://api.github.com/repos/'+ermittleRepo()+pfad, Object.assign({}, opts||{}, {
    headers: Object.assign({ 'Authorization':'Bearer '+holeToken(), 'Accept':'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28' }, (opts||{}).headers||{})
  }));
}
function secretFehler(status){
  return status===403 || status===404 ? 'Token hat keine Berechtigung „Secrets: Read and write“ für dieses Repo' : 'GitHub antwortet mit Fehler '+status;
}
async function listeSecrets(){
  const r = await githubApi('/actions/secrets?per_page=100');
  if (!r.ok) throw new Error(secretFehler(r.status));
  secretNamenCache = ((await r.json()).secrets||[]).map(s=>s.name);
  return secretNamenCache;
}
async function setzeSecret(name, wert){
  const r = await githubApi('/actions/secrets/public-key');
  if (!r.ok) throw new Error(secretFehler(r.status));
  const { key_id, key } = await r.json();
  const versiegelt = versiegle(new TextEncoder().encode(wert), b64zuBytes(key));
  const put = await githubApi('/actions/secrets/'+encodeURIComponent(name), { method:'PUT', body: JSON.stringify({ encrypted_value: bytesZuB64(versiegelt), key_id }) });
  if (!put.ok) throw new Error('Secret '+name+' konnte nicht gespeichert werden ('+put.status+')');
}
function konkat(a, b){ const o = new Uint8Array(a.length+b.length); o.set(a, 0); o.set(b, a.length); return o; }
// libsodium crypto_box_seal: ephemeres Schlüsselpaar, Nonce = BLAKE2b-24(ephemerer PK || Empfänger-PK)
function versiegle(nachricht, empfaengerPk){
  if (typeof nacl === 'undefined') throw new Error('nacl-fast.min.js fehlt');
  const eph = nacl.box.keyPair();
  const nonce = blake2b(konkat(eph.publicKey, empfaengerPk), 24);
  const box = nacl.box(nachricht, nonce, empfaengerPk, eph.secretKey);
  return konkat(eph.publicKey, box);
}

/* ---------- BLAKE2b (RFC 7693), nur für die Sealed-Box-Nonce ---------- */
const BLAKE2B_IV32 = new Uint32Array([
  0xF3BCC908, 0x6A09E667, 0x84CAA73B, 0xBB67AE85, 0xFE94F82B, 0x3C6EF372, 0x5F1D36F1, 0xA54FF53A,
  0xADE682D1, 0x510E527F, 0x2B3E6C1F, 0x9B05688C, 0xFB41BD6B, 0x1F83D9AB, 0x137E2179, 0x5BE0CD19 ]);
const BLAKE2B_SIGMA = new Uint8Array([
  0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,  14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3,
  11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4,  7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8,
  9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13,  2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9,
  12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11,  13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10,
  6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5,  10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0,
  0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,  14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3 ].map(x=>x*2));
function blake2b(eingabe, outlen){
  const v = new Uint32Array(32), m = new Uint32Array(32);
  const ctx = { b:new Uint8Array(128), h:new Uint32Array(16), t:0, c:0 };
  const add64AA = (a, b) => { const o0 = v[a]+v[b]; let o1 = v[a+1]+v[b+1]; if (o0 >= 0x100000000) o1++; v[a] = o0; v[a+1] = o1; };
  const add64AC = (a, b0, b1) => { let o0 = v[a]+b0; if (b0 < 0) o0 += 0x100000000; let o1 = v[a+1]+b1; if (o0 >= 0x100000000) o1++; v[a] = o0; v[a+1] = o1; };
  const G = (a, b, c, d, ix, iy) => {
    const x0 = m[ix], x1 = m[ix+1], y0 = m[iy], y1 = m[iy+1];
    add64AA(a, b); add64AC(a, x0, x1);
    let xor0 = v[d]^v[a], xor1 = v[d+1]^v[a+1];
    v[d] = xor1; v[d+1] = xor0;
    add64AA(c, d);
    xor0 = v[b]^v[c]; xor1 = v[b+1]^v[c+1];
    v[b] = (xor0 >>> 24) ^ (xor1 << 8); v[b+1] = (xor1 >>> 24) ^ (xor0 << 8);
    add64AA(a, b); add64AC(a, y0, y1);
    xor0 = v[d]^v[a]; xor1 = v[d+1]^v[a+1];
    v[d] = (xor0 >>> 16) ^ (xor1 << 16); v[d+1] = (xor1 >>> 16) ^ (xor0 << 16);
    add64AA(c, d);
    xor0 = v[b]^v[c]; xor1 = v[b+1]^v[c+1];
    v[b] = (xor1 >>> 31) ^ (xor0 << 1); v[b+1] = (xor0 >>> 31) ^ (xor1 << 1);
  };
  const compress = (last) => {
    for (let i=0; i<16; i++) { v[i] = ctx.h[i]; v[i+16] = BLAKE2B_IV32[i]; }
    v[24] = v[24] ^ ctx.t; v[25] = v[25] ^ (ctx.t / 0x100000000);
    if (last) { v[28] = ~v[28]; v[29] = ~v[29]; }
    for (let i=0; i<32; i++) m[i] = ctx.b[4*i] ^ (ctx.b[4*i+1] << 8) ^ (ctx.b[4*i+2] << 16) ^ (ctx.b[4*i+3] << 24);
    for (let i=0; i<12; i++) {
      const s = i*16;
      G(0, 8,16,24, BLAKE2B_SIGMA[s+0], BLAKE2B_SIGMA[s+1]);
      G(2,10,18,26, BLAKE2B_SIGMA[s+2], BLAKE2B_SIGMA[s+3]);
      G(4,12,20,28, BLAKE2B_SIGMA[s+4], BLAKE2B_SIGMA[s+5]);
      G(6,14,22,30, BLAKE2B_SIGMA[s+6], BLAKE2B_SIGMA[s+7]);
      G(0,10,20,30, BLAKE2B_SIGMA[s+8], BLAKE2B_SIGMA[s+9]);
      G(2,12,22,24, BLAKE2B_SIGMA[s+10], BLAKE2B_SIGMA[s+11]);
      G(4,14,16,26, BLAKE2B_SIGMA[s+12], BLAKE2B_SIGMA[s+13]);
      G(6, 8,18,28, BLAKE2B_SIGMA[s+14], BLAKE2B_SIGMA[s+15]);
    }
    for (let i=0; i<16; i++) ctx.h[i] = ctx.h[i] ^ v[i] ^ v[i+16];
  };
  for (let i=0; i<16; i++) ctx.h[i] = BLAKE2B_IV32[i];
  ctx.h[0] ^= 0x01010000 ^ outlen;
  for (let i=0; i<eingabe.length; i++) {
    if (ctx.c === 128) { ctx.t += ctx.c; compress(false); ctx.c = 0; }
    ctx.b[ctx.c++] = eingabe[i];
  }
  ctx.t += ctx.c;
  while (ctx.c < 128) ctx.b[ctx.c++] = 0;
  compress(true);
  const out = new Uint8Array(outlen);
  for (let i=0; i<outlen; i++) out[i] = ctx.h[i>>2] >> (8*(i&3));
  return out;
}

/* ---------- Impressum & Datenschutzerklärung ---------- */
// Angaben entsprechend www.fc-tegernheim.de (Impressum, Datenschutz, Vorstand). Bei Änderungen dort bitte hier nachziehen.
const VEREIN = {
  name: 'Fußball-Club Tegernheim e.V.', strasse: 'Am Hohen Sand 10', ort: '93105 Tegernheim',
  telefon: '09403-2033', mail: 'info@fc-tegernheim.de', web: 'https://www.fc-tegernheim.de/',
  register: 'Amtsgericht Regensburg, Vereinsregister VR 322',
  vorstand: '1. Vorstand Artur Weickl, 2. Vorstand Walter Hölzl, 3. Vorstand Andreas Wedl',
  abteilung: 'Abteilung Fußball, Abteilungsleitung Jens Köhn',
  dsb: 'datenschutzbeauftragter@fc-tegernheim.de'
};
function impressumHtml(){
  const v = VEREIN;
  return '<div class="karte"><h3><span class="punkt"></span>Impressum</h3>'
    + '<h4>Angaben gemäß § 5 DDG</h4>'
    + '<p><b>'+esc(v.name)+'</b><br>'+esc(v.strasse)+'<br>'+esc(v.ort)+'</p>'
    + '<p>Telefon: '+esc(v.telefon)+'<br>E-Mail: <a href="mailto:'+esc(v.mail)+'">'+esc(v.mail)+'</a><br>Internet: <a href="'+esc(v.web)+'" target="_blank" rel="noopener">www.fc-tegernheim.de</a></p>'
    + '<p>Eingetragen beim '+esc(v.register)+'.</p>'
    + '<h4>Vertretungsberechtigter Vorstand</h4><p>'+esc(v.vorstand)+'</p>'
    + '<h4>Verantwortlich für diese Anwendung</h4><p>'+esc(v.abteilung)+'<br>Kontakt über die oben genannten Vereinsdaten.</p>'
    + '<h4>Hosting</h4><p>Diese Anwendung wird über GitHub Pages bereitgestellt: GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA. Einzelheiten zur Datenverarbeitung stehen in der <button type="button" class="link" style="background:none;border:0;padding:0;font:inherit;color:var(--rot-dunkel);text-decoration:underline;cursor:pointer" data-fn="wechsle" data-args="[&quot;datenschutz&quot;]">Datenschutzerklärung</button>.</p>'
    + '<h4>Verbraucherstreitbeilegung</h4><p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).</p>'
    + '<h4>Haftung für Inhalte</h4><p>Die Inhalte dieser Anwendung wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Belegungsdaten können wir jedoch keine Gewähr übernehmen; maßgeblich ist die Auskunft der Abteilungsleitung. Als Diensteanbieter sind wir für eigene Inhalte nach den allgemeinen Gesetzen verantwortlich. Sollten Ihnen problematische oder rechtswidrige Inhalte auffallen, bitten wir um einen Hinweis an die oben genannte Kontaktadresse.</p>'
    + '<h4>Haftung für Links</h4><p>Diese Anwendung enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Für diese fremden Inhalte ist stets der jeweilige Anbieter verantwortlich. Bei Bekanntwerden von Rechtsverletzungen werden wir derartige Links umgehend entfernen.</p>'
    + '<h4>Urheberrecht</h4><p>Die Inhalte und Gestaltung dieser Anwendung, einschließlich des Vereinswappens, unterliegen dem Urheberrecht. Jede Verwendung außerhalb der Grenzen des Urheberrechts bedarf der Zustimmung des Vereins.</p>'
    + '</div>';
}
function datenschutzHtml(){
  const v = VEREIN;
  const k = (t) => '<div class="karte">'+t+'</div>';
  return k('<h3><span class="punkt"></span>Datenschutzerklärung</h3>'
      + '<p>Diese Datenschutzerklärung gilt für die Online-Platzbelegung der Abteilung Fußball des '+esc(v.name)+' (im Folgenden „Anwendung“). Sie informiert darüber, welche personenbezogenen Daten beim Aufruf und bei der Nutzung der Anwendung verarbeitet werden, nach Art. 13 und 14 der Datenschutz-Grundverordnung (DSGVO).</p>'
      + '<h4>I. Verantwortlicher</h4>'
      + '<p><b>'+esc(v.name)+'</b><br>'+esc(v.strasse)+'<br>'+esc(v.ort)+'<br>Telefon: '+esc(v.telefon)+'<br>E-Mail: <a href="mailto:'+esc(v.mail)+'">'+esc(v.mail)+'</a><br>Vertreten durch den Vorstand: '+esc(v.vorstand)+'</p>'
      + '<p>Datenschutzbeauftragter des Vereins: <a href="mailto:'+esc(v.dsb)+'">'+esc(v.dsb)+'</a></p>')
    + k('<h4>II. Was die Anwendung ist und welche Daten öffentlich sichtbar sind</h4>'
      + '<p>Die Anwendung zeigt die Belegung der Fußballplätze und Kabinen des Vereins. Sie ist ohne Anmeldung einsehbar. Der Belegungsplan enthält ausschließlich sachbezogene Angaben:</p>'
      + '<ul><li>Platz, Datum, Uhrzeit, Art der Belegung (Training oder Spiel)</li><li>Mannschaft (z. B. „1. Mannschaft“, „B-Jugend“)</li><li>zugeordnete Kabinen, Status der Freigabe (Ampel) und Sperren mit Grund</li><li>optionale Notiz, z. B. der Name des Gastvereins</li></ul>'
      + '<p>Namen oder Kontaktdaten von Trainerinnen, Trainern oder anderen Personen werden im öffentlichen Belegungsplan nicht gespeichert. Nutzerinnen und Nutzer mit Bearbeitungszugang sind angehalten, in Notizen und Begründungen keine Personennamen einzutragen. Sollte dennoch ein Name eingetragen worden sein, wird er auf Hinweis an die oben genannte Kontaktadresse umgehend entfernt.</p>'
      + '<p>Der Belegungsplan wird in einem öffentlich einsehbaren Datenbestand bei GitHub gespeichert, in dem auch frühere Versionen nachvollziehbar sind. Auch aus diesem Grund werden dort keine personenbezogenen Daten abgelegt.</p>')
    + k('<h4>III. Bereitstellung der Anwendung, Hosting und Logdaten</h4>'
      + '<p>Die Anwendung wird über GitHub Pages bereitgestellt und liest den Belegungsplan über die GitHub-Schnittstelle. Anbieter ist GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA (in Europa: GitHub B.V., Prins Bernhardplein 200, 1097 JB Amsterdam, Niederlande). Bei jedem Aufruf übermittelt Ihr Browser technisch bedingt folgende Daten an GitHub, die dort in Logdateien verarbeitet werden können:</p>'
      + '<ul><li>IP-Adresse des aufrufenden Geräts</li><li>Datum und Uhrzeit des Zugriffs</li><li>aufgerufene Adresse und übertragene Datenmenge</li><li>Browsertyp und -version, Betriebssystem</li></ul>'
      + '<p><b>Zweck und Rechtsgrundlage:</b> Die Verarbeitung ist erforderlich, um die Anwendung auszuliefern und ihre Sicherheit und Stabilität zu gewährleisten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt in der zuverlässigen und kostengünstigen Bereitstellung des Belegungsplans für Mitglieder, Eltern und Gastvereine.</p>'
      + '<p><b>Drittlandübermittlung:</b> GitHub verarbeitet Daten auch in den USA. GitHub ist unter dem EU-US Data Privacy Framework zertifiziert; die Übermittlung stützt sich auf den Angemessenheitsbeschluss der EU-Kommission (Art. 45 DSGVO) sowie ergänzend auf die EU-Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO).</p>'
      + '<p><b>Speicherdauer:</b> Die Speicherdauer der Logdaten richtet sich nach den Datenschutzbestimmungen von GitHub: <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">GitHub General Privacy Statement</a>. Wir selbst haben keinen Zugriff auf diese Logdaten.</p>')
    + k('<h4>IV. Speicherung im Browser (Local Storage)</h4>'
      + '<p>Die Anwendung setzt keine Cookies. Sie speichert im lokalen Speicher Ihres Browsers (Local Storage) einen Zwischenspeicher des Belegungsplans, damit der Plan auch bei schlechter Verbindung angezeigt werden kann, sowie nach einer Anmeldung den Zugangsschlüssel für die gewählte Rolle. Diese Daten verbleiben auf Ihrem Gerät und werden nicht an uns oder Dritte übermittelt. Die Speicherung ist für die von Ihnen gewünschte Funktion unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Sie können die Daten jederzeit über „Abmelden“ in der Anwendung oder über die Einstellungen Ihres Browsers löschen.</p>')
    + k('<h4>V. Anmeldung und Bearbeitung durch Trainer und Abteilungsleitung</h4>'
      + '<p>Für das Eintragen und Freigeben von Belegungen gibt es zwei Zugänge (Trainer, Abteilungsleitung), die jeweils über ein gemeinsames Passwort oder einen QR-Code genutzt werden. Eine persönliche Registrierung findet nicht statt; es werden keine Benutzerkonten mit Namen geführt.</p>'
      + '<p>Jede Änderung am Belegungsplan wird in der Versionshistorie bei GitHub mit Datum, Uhrzeit und der Rolle („Trainer“ oder „Leitung“) gespeichert, nicht mit dem Namen der ändernden Person. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Mitgliedschaft bzw. Tätigkeit für den Verein) und Art. 6 Abs. 1 lit. f DSGVO (Nachvollziehbarkeit und Schutz vor Missbrauch).</p>')
    + k('<h4>VI. E-Mail-Benachrichtigungen an Abteilungsleitung und Mannschaftsverantwortliche</h4>'
      + '<p>Die Abteilungsleitung kann für sich und je Mannschaft Ansprechpartner (Name, optional) und E-Mail-Adressen hinterlegen. Diese Kontaktdaten werden ausschließlich verschlüsselt (AES-256-GCM) gespeichert; der Schlüssel liegt nur bei der Abteilungsleitung und als geschütztes Geheimnis (GitHub Secret) für den automatischen Versand. Öffentlich sind die Kontaktdaten nicht lesbar.</p>'
      + '<p>Bei Änderungen am Belegungsplan verschickt ein automatischer Ablauf (GitHub Actions) E-Mails an die betroffene Mannschaft bzw. die Abteilungsleitung, zum Beispiel bei neuen Anfragen, Genehmigungen, Ablehnungen oder Sperren. Der Versand erfolgt über das E-Mail-Postfach des Vereins. Empfänger sind nur die jeweils hinterlegten Adressen der betroffenen Mannschaft und der Abteilungsleitung.</p>'
      + '<p><b>Rechtsgrundlage:</b> Art. 6 Abs. 1 lit. b DSGVO (Wahrnehmung der Trainer- bzw. Leitungsfunktion im Verein) und Art. 6 Abs. 1 lit. f DSGVO (reibungslose Organisation des Spiel- und Trainingsbetriebs). <b>Speicherdauer:</b> Die Kontaktdaten werden gelöscht, sobald die Person ihre Funktion nicht mehr ausübt, spätestens nach Ablauf der Saison, in der die Funktion endete. Betroffene können sich jederzeit an die Abteilungsleitung wenden, um ihre Daten ändern oder löschen zu lassen.</p>')
    + k('<h4>VII. Keine Analyse, keine Einbindung Dritter</h4>'
      + '<p>Die Anwendung verwendet keine Analyse- oder Trackingdienste, keine Social-Media-Plugins und keine von Dritten geladenen Schriftarten oder Programmbibliotheken. QR-Codes werden lokal in Ihrem Browser erzeugt. Eine Weitergabe personenbezogener Daten an Dritte findet über die unter III. beschriebene technische Bereitstellung hinaus nicht statt.</p>')
    + k('<h4>VIII. Ihre Rechte</h4>'
      + '<p>Sie haben gegenüber dem Verein folgende Rechte hinsichtlich der Sie betreffenden personenbezogenen Daten:</p>'
      + '<ul><li>Recht auf Auskunft (Art. 15 DSGVO)</li><li>Recht auf Berichtigung (Art. 16 DSGVO)</li><li>Recht auf Löschung (Art. 17 DSGVO)</li><li>Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)</li><li>Recht auf Datenübertragbarkeit (Art. 20 DSGVO)</li><li>Recht auf Widerspruch gegen Verarbeitungen, die auf Art. 6 Abs. 1 lit. f DSGVO beruhen (Art. 21 DSGVO)</li></ul>'
      + '<p>Zur Ausübung Ihrer Rechte genügt eine formlose Nachricht an <a href="mailto:'+esc(v.mail)+'">'+esc(v.mail)+'</a> oder an den Datenschutzbeauftragten. Sie haben außerdem das Recht, sich bei einer Aufsichtsbehörde zu beschweren (Art. 77 DSGVO). Zuständig ist das Bayerische Landesamt für Datenschutzaufsicht (BayLDA), Promenade 18, 91522 Ansbach, <a href="https://www.lda.bayern.de/" target="_blank" rel="noopener">www.lda.bayern.de</a>.</p>')
    + k('<h4>IX. Löschung und Änderungen</h4>'
      + '<p>Belegungsdaten vergangener Saisons werden regelmäßig aus dem aktiven Plan archiviert bzw. gelöscht. Wir passen diese Datenschutzerklärung an, wenn sich die Anwendung oder die Rechtslage ändert; es gilt die jeweils hier veröffentlichte Fassung.</p>'
      + '<div class="stand">Stand: September 2026</div>');
}
function renderRechtliches(art){
  $('#app').innerHTML = '<div class="wochennav"><h2>'+(art==='impressum' ? 'Impressum' : 'Datenschutz')+'</h2>'
    + '<button class="heute-btn" data-fn="wechsle" data-args="[&quot;anlage&quot;]">Zurück zum Plan</button></div>'
    + '<div class="recht">'+(art==='impressum' ? impressumHtml() : datenschutzHtml())+'</div>';
}

/* ================= Start ================= */
$('#fab').onclick = () => oeffneBuchung(null, null, ansicht==='anlage' ? anlageTag : null);
// Alle Schaltflächen tragen data-fn (Klick), data-fn-change (Änderung) oder data-enter (Eingabetaste) statt Inline-Skripten.
// So kann die Content-Security-Policy in index.html Inline-Skripte verbieten (Schutz vor eingeschleustem Code).
const AKTIONEN = { wechsle, schiebeWoche, geheHeute, schiebeTag, anlageHeute, oeffneBuchung, aenderePlatz, aendereListe,
  entferneListe, fuegeListeHinzu, uebernehmeEinstellungen, anmelden, abmelden, speicherePasswoerter, entscheide, konfliktGeklaert,
  sperreAnlegen, sperreAufheben, speicherePostfach, testMail, sicherungSenden, speichereKontakte, druckeQr };
function argumenteVon(el){ try { return JSON.parse(el.dataset.args || '[]'); } catch(e){ return []; } }
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-fn]');
  if (!el || !AKTIONEN[el.dataset.fn]) return;
  AKTIONEN[el.dataset.fn](...argumenteVon(el));
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-fn-change]');
  if (!el || !AKTIONEN[el.dataset.fnChange]) return;
  AKTIONEN[el.dataset.fnChange](...argumenteVon(el), el.value);
});
document.addEventListener('keydown', ev => {
  const fn = ev.key === 'Enter' && ev.target.dataset ? ev.target.dataset.enter : null;
  if (fn && AKTIONEN[fn]) AKTIONEN[fn]();
});

render();
ladeDaten().then(async () => {
  if (anmeldungAusUrl) { const pw = anmeldungAusUrl; anmeldungAusUrl = null; await anmelden(pw); }
  render();
  verlaengereSerien();
});
// Plan regelmäßig aktualisieren (z. B. Anzeige im Vereinsheim); nicht während Eingaben in Formularen
setInterval(() => {
  if (speichertGerade || document.querySelector('.modal-hg') || ['qr','sperren','stammdaten','impressum','datenschutz'].includes(ansicht)) return;
  ladeDaten().then(render);
}, 120000);
