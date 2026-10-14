// Nettoie et valide les réponses du formulaire.
// Sortie : { ok, erreur?, lead? }. Un lead invalide ne va jamais jusqu'à l'IA ni à Brevo.
const CHOIX = {
  pratique: ['route', 'trail', 'les-deux'],
  frequence: ['moins-1', '1-2', '3-4', '5-plus'],
  objectif: ['forme', '10km', 'semi', 'marathon', 'trail-court', 'ultra'],
  budget: ['moins-150', '150-400', '400-plus'],
};
const f = $json.formulaire || {};
const texte = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

if (texte(f.site_web, 200)) {
  return { ok: false, erreur: 'spam' }; // champ piège rempli : un robot
}

const lead = {
  email: texte(f.email, 200).toLowerCase(),
  prenom: texte(f.prenom, 60).replace(/[<>]/g, ''),
  pratique: texte(f.pratique, 20),
  frequence: texte(f.frequence, 20),
  objectif: texte(f.objectif, 20),
  budget: texte(f.budget, 20),
  consentement: f.consentement === true || f.consentement === 'oui' || f.consentement === 'on',
};

if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(lead.email)) {
  return { ok: false, erreur: 'Adresse email invalide.' };
}
if (!lead.consentement) {
  return { ok: false, erreur: 'Le consentement est obligatoire pour recevoir nos emails.' };
}
for (const [champ, valeurs] of Object.entries(CHOIX)) {
  if (!valeurs.includes(lead[champ])) {
    return { ok: false, erreur: `Réponse invalide pour « ${champ} ».` };
  }
}
return { ok: true, lead };
