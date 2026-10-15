// Étape 4 : calcule les chiffres du tableau de bord (mode « une fois pour tous les éléments »).
// Entrées : les contacts Brevo et les statistiques d'envoi Brevo par étiquette d'email.
// Sortie publique : uniquement des agrégats et le journal des décisions de l'IA,
// jamais d'email ni de prénom.
const { config } = $('Configuration').first().json;
const contacts = ($('Brevo : lister les contacts').first().json.contacts || [])
  .filter((c) => c.attributes && c.attributes.SEGMENT);
const etiquettes = $('Étiquettes à mesurer').all().map((i) => i.json);
const envois = $input.all().map((i) => i.json);
const arrondi = (n, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

const segments = Object.fromEntries(Object.entries(SEGMENTS_LIBELLES).map(([k, libelle]) => [k, { libelle, nombre: 0 }]));
const tranches = Array.from({ length: 10 }, (_, i) => ({ de: i * 10, a: i * 10 + 9, nombre: 0 }));
const relances = { proposees: 0, envoyees: 0, ignorees: 0 };
let sommeScores = 0; let scores = 0; let chauds = 0; let replis = 0; let ia = 0; let cout = 0;

for (const c of contacts) {
  const a = c.attributes;
  if (segments[a.SEGMENT]) segments[a.SEGMENT].nombre++;
  const score = Number(a.SCORE) || 0;
  if (a.SEGMENT !== 'A_QUALIFIER') {
    sommeScores += score; scores++;
    tranches[Math.min(9, Math.floor(score / 10))].nombre++;
    if (score >= config.seuilLeadChaud) chauds++;
  }
  if (a.SOURCE_QUALIF === 'repli') replis++; else ia++;
  cout += Number(a.COUT_IA_USD) || 0;
  if (a.RELANCE_STATUT === 'proposee') relances.proposees++;
  if (a.RELANCE_STATUT === 'envoyee') relances.envoyees++;
  if (a.RELANCE_STATUT === 'ignoree') relances.ignorees++;
}

const emails = {};
etiquettes.forEach((t, i) => {
  const s = envois[i] || {};
  emails[t.cle] = {
    libelle: t.libelle,
    envoyes: s.requests || 0,
    delivres: s.delivered || 0,
    ouvertures: s.uniqueOpens || 0,
    clics: s.uniqueClicks || 0,
    rejets: (s.hardBounces || 0) + (s.softBounces || 0) + (s.blocked || 0),
  };
});

const journal = contacts
  .map((c) => ({ c, date: c.attributes.QUALIFIE_LE || (c.modifiedAt || '').slice(0, 10) }))
  .sort((x, y) => String(y.date).localeCompare(String(x.date)) || String(y.c.modifiedAt).localeCompare(String(x.c.modifiedAt)))
  .slice(0, 15)
  .map(({ c, date }) => ({
    date,
    segment: SEGMENTS_LIBELLES[c.attributes.SEGMENT] ?? c.attributes.SEGMENT,
    niveau: NIVEAUX_LIBELLES[c.attributes.NIVEAU] ?? '',
    score: Number(c.attributes.SCORE) || 0,
    source: c.attributes.SOURCE_QUALIF === 'repli' ? 'Repli' : 'IA',
    raison: String(c.attributes.RAISON_IA || '').slice(0, 250),
  }));

return [{
  json: {
    misAJour: new Date().toISOString(),
    inscrits: contacts.length,
    seuilLeadChaud: config.seuilLeadChaud,
    leadsChauds: chauds,
    scoreMoyen: scores ? Math.round(sommeScores / scores) : 0,
    segments,
    tranchesScore: tranches,
    ia: {
      modele: config.modele,
      qualifications: ia,
      replis,
      tauxRepli: contacts.length ? arrondi(replis / contacts.length, 3) : 0,
      coutTotalUsd: arrondi(cout),
      coutMoyenUsd: contacts.length ? arrondi(cout / contacts.length) : 0,
    },
    relances,
    emails,
    journal,
  },
}];
