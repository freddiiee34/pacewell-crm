// Étape 3 : demande à Claude un message de relance pour un inscrit inactif.
// Toujours sans prénom ni email : seulement le profil sportif et la durée d'inactivité.
const { contact: c } = $json;
const { config } = $('Configuration').item.json;

const consignes = `Tu écris un email de relance pour ${config.marque}, une boutique en ligne de running et de trail.
Le lecteur s'est inscrit il y a un moment et n'a plus donné de nouvelles. Tu le tutoies.
Ne commence pas par une salutation : « Salut Prénom, » est ajouté automatiquement.
But : lui redonner envie de courir et de revenir, avec UNE idée concrète adaptée à son profil et à la saison,
sans culpabiliser ni insister. Court, chaleureux, pas commercial.

Interdits absolus : prix, pourcentages, promotions, réductions, cadeaux, liens, adresses email, emoji,
noms de marques, promesses de santé ou de résultat, informations inventées sur ${config.marque}.

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"objet": "60 caractères maximum, sans emoji",
 "message": "2 courts paragraphes séparés par une ligne vide, 90 mots maximum au total",
 "angle": "une phrase pour le responsable CRM : pourquoi cet angle pour ce profil"}`;

const profil = {
  segment: SEGMENTS_LIBELLES[c.segment] ?? c.segment,
  niveau: NIVEAUX_LIBELLES[c.niveau] ?? 'inconnu',
  pratique: lisible('pratique', c.pratique),
  frequence: lisible('frequence', c.frequence),
  objectif: lisible('objectif', c.objectif),
  sans_nouvelles_depuis_jours: c.joursInactif,
  mois_actuel: new Date().toLocaleDateString('fr-FR', { month: 'long' }),
};

return {
  contact: c,
  requete: {
    model: config.modele,
    max_tokens: 1000,
    thinking: { type: 'disabled' },
    system: consignes,
    messages: [{ role: 'user', content: 'Profil de l\'inscrit :\n' + JSON.stringify(profil, null, 1) }],
  },
};
