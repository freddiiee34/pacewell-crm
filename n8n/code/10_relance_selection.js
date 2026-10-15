// Étape 3 : choisit les inscrits à relancer (mode « une fois pour tous les éléments »).
// Entrée : la liste des contacts Brevo. Sortie : un élément par inscrit à relancer.
// Règles : inscrit Pacewell (segment connu), sans activité depuis N jours, pas déjà relancé
// pendant cette période, pas désinscrit ; les meilleurs scores d'abord, M au maximum.
const { config } = $('Configuration').first().json;
const contacts = $input.all().flatMap((i) => i.json.contacts || []);
const maintenant = Date.now();
const jours = (date) => (date ? Math.floor((maintenant - new Date(date).getTime()) / 86400000) : null);

const candidats = [];
for (const c of contacts) {
  const a = c.attributes || {};
  if (!a.SEGMENT || a.SEGMENT === 'A_QUALIFIER' || c.emailBlacklisted) continue;
  const inactif = jours(a.DERNIERE_ACTIVITE || a.QUALIFIE_LE || c.createdAt);
  if (inactif === null || inactif < config.joursInactivite) continue;
  if (a.RELANCE_STATUT === 'proposee') continue; // déjà en attente de ta décision
  const derniereRelance = jours(a.RELANCE_LE);
  if (derniereRelance !== null && derniereRelance < config.joursInactivite) continue;
  candidats.push({
    email: c.email,
    prenom: a.PRENOM || '',
    segment: a.SEGMENT, niveau: a.NIVEAU || '', score: Number(a.SCORE) || 0,
    pratique: a.PRATIQUE, frequence: a.FREQUENCE, objectif: a.OBJECTIF, budget: a.BUDGET,
    joursInactif: inactif,
  });
}

candidats.sort((x, y) => y.score - x.score);
return candidats.slice(0, config.maxRelances).map((contact) => ({ json: { contact } }));
