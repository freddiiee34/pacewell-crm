// Évalue la qualification par l'IA sur 30 profils annotés à la main (evaluation/profils.json).
// Le script utilise exactement le prompt et la validation du workflow n8n (n8n/code/04 et 05).
//
// Usage (Node 18 ou plus récent, aucune installation) :
//   Windows :  set ANTHROPIC_API_KEY=cle-anthropic   puis   node scripts\evaluer.mjs
//   Mac/Linux: ANTHROPIC_API_KEY=cle-anthropic node scripts/evaluer.mjs
// Coût : environ 0,003 $ pour les 30 profils.
// Résultat : evaluation/resultats.json, recopié dans landing/evaluation.json pour le tableau de bord.
import { readFileSync, writeFileSync } from 'node:fs';

const racine = new URL('../', import.meta.url);
const lire = (chemin) => readFileSync(new URL(chemin, racine), 'utf8');
const cle = (process.env.ANTHROPIC_API_KEY || '').trim();
const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
if (!cle) {
  console.error('Il manque la clé : définis ANTHROPIC_API_KEY (voir l\'en-tête du script).');
  process.exit(1);
}

// Exécute le code d'un nœud n8n hors de n8n (mêmes règles que les tests).
function executer(fichier, json, autres) {
  const $ = (noeud) => ({ item: { json: autres[noeud] }, first: () => ({ json: autres[noeud] }) });
  return new Function('$json', '$', lire(`n8n/code/${fichier}`))(json, $);
}
const config = executer('01_configuration.js', {}, {}).config;
const temperature = (score) => (score >= 70 ? 'chaud' : score >= 40 ? 'tiede' : 'froid');
const profils = JSON.parse(lire('evaluation/profils.json'));

const details = [];
for (const p of profils) {
  const lead = { email: 'evaluation@exemple.fr', prenom: '', pratique: p.pratique, frequence: p.frequence, objectif: p.objectif, budget: p.budget };
  const { requete } = executer('04_preparer_prompt.js', { lead }, { Configuration: { config } });
  const debut = Date.now();
  let reponse;
  try {
    const r = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: { 'x-api-key': cle, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(requete),
    });
    reponse = { statusCode: r.status, body: await r.json().catch(() => ({})) };
  } catch (err) {
    reponse = { body: {} };
  }
  const duree = Date.now() - debut;
  if (reponse.statusCode === 401) {
    console.error('Clé refusée par Anthropic : vérifie ANTHROPIC_API_KEY.');
    process.exit(1);
  }
  const { qualification: q } = executer('05_valider_ia.js', reponse, { Configuration: { config }, 'Dédoublonner': { lead } });
  const t = temperature(q.score);
  details.push({
    id: p.id, profil: `${p.pratique} · ${p.frequence} · ${p.objectif} · ${p.budget}`, note: p.note,
    attendu: p.attendu, obtenu: { segment: q.segment, score: q.score, temperature: t, source: q.source, raison: q.raison },
    segmentCorrect: q.segment === p.attendu.segment,
    temperatureCorrecte: q.source === 'ia' && p.attendu.temperatures.includes(t),
    coutUsd: q.cout_usd, dureeMs: duree,
  });
  process.stdout.write(`${details.at(-1).segmentCorrect ? '✓' : '✗'} ${String(p.id).padStart(2)} ${p.note.padEnd(42)} ${q.segment.padEnd(17)} ${String(q.score).padStart(3)}  ${t}\n`);
}

const n = details.length;
const somme = (f) => details.reduce((s, d) => s + f(d), 0);
const resultats = {
  date: new Date().toISOString().slice(0, 10),
  modele: config.modele,
  profils: n,
  segmentsCorrects: somme((d) => d.segmentCorrect ? 1 : 0),
  temperaturesCorrectes: somme((d) => d.temperatureCorrecte ? 1 : 0),
  replis: somme((d) => d.obtenu.source === 'repli' ? 1 : 0),
  coutTotalUsd: Math.round(somme((d) => d.coutUsd) * 1e6) / 1e6,
  dureeMoyenneMs: Math.round(somme((d) => d.dureeMs) / n),
  details,
};
const json = JSON.stringify(resultats, null, 1);
writeFileSync(new URL('evaluation/resultats.json', racine), json);
writeFileSync(new URL('landing/evaluation.json', racine), json);

console.log(`\nSegment correct : ${resultats.segmentsCorrects}/${n}`);
console.log(`Température correcte : ${resultats.temperaturesCorrectes}/${n}`);
console.log(`Replis : ${resultats.replis}   Coût total : ${resultats.coutTotalUsd} $   Durée moyenne : ${resultats.dureeMoyenneMs} ms`);
console.log('Résultats écrits dans evaluation/resultats.json et landing/evaluation.json.');
