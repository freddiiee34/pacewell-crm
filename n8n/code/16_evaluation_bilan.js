// Évaluation : compare chaque qualification à l'annotation (mode « une fois pour tous les éléments »).
const { config } = $('Configuration').first().json;
const profils = $('Profils annotés').all().map((i) => i.json.profil);
const temperature = (score) => (score >= 70 ? 'chaud' : score >= 40 ? 'tiede' : 'froid');

const details = $input.all().map((i, k) => {
  const p = profils[k];
  const q = i.json.qualification;
  const t = temperature(q.score);
  return {
    id: p.id, profil: `${p.pratique} · ${p.frequence} · ${p.objectif} · ${p.budget}`, note: p.note,
    attendu: p.attendu, obtenu: { segment: q.segment, score: q.score, temperature: t, source: q.source, raison: q.raison },
    segmentCorrect: q.segment === p.attendu.segment,
    temperatureCorrecte: q.source === 'ia' && p.attendu.temperatures.includes(t),
    coutUsd: q.cout_usd,
  };
});
const somme = (f) => details.reduce((s, d) => s + f(d), 0);
return [{
  json: {
    date: new Date().toISOString().slice(0, 10),
    modele: config.modele,
    profils: details.length,
    segmentsCorrects: somme((d) => (d.segmentCorrect ? 1 : 0)),
    temperaturesCorrectes: somme((d) => (d.temperatureCorrecte ? 1 : 0)),
    replis: somme((d) => (d.obtenu.source === 'repli' ? 1 : 0)),
    coutTotalUsd: Math.round(somme((d) => d.coutUsd) * 1e6) / 1e6,
    details,
  },
}];
