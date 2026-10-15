// Étape 2 : demande à Claude le contenu de l'email de bienvenue.
// Comme pour la qualification, l'IA ne reçoit ni le prénom ni l'email :
// le prénom est ajouté ensuite par le gabarit.
const { lead, qualification: q } = $('Préparer Brevo').item.json;
const { config } = $('Configuration').item.json;

const consignes = `Tu écris l'email de bienvenue de ${config.marque}, une boutique en ligne de running et de trail.
Le lecteur vient de s'inscrire. Ne commence pas par une salutation : « Salut Prénom, » est ajouté automatiquement. Tu le tutoies, sur un ton chaleureux, direct et concret, comme un vendeur passionné en magasin.
Tu t'appuies uniquement sur son profil. Chaque conseil doit être utile cette semaine pour CE coureur (fréquence, objectif, terrain).

Interdits absolus : prix, pourcentages, promotions, réductions, cadeaux, liens, adresses email, emoji,
noms de marques, promesses de santé ou de résultat, informations inventées sur ${config.marque} (livraison, retours, magasins).

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"objet": "objet de l'email, 60 caractères maximum, sans emoji",
 "intro": "2 phrases, 45 mots maximum, qui montrent que tu as compris son profil",
 "conseils": ["conseil 1, 25 mots maximum", "conseil 2", "conseil 3"],
 "selection": "une phrase, 30 mots maximum, sur le type d'équipement à regarder en priorité pour son profil, sans marque"}`;

const profil = {
  segment: SEGMENTS_LIBELLES[q.segment] ?? q.segment,
  niveau: NIVEAUX_LIBELLES[q.niveau] ?? 'inconnu',
  pratique: lisible('pratique', lead.pratique),
  frequence: lisible('frequence', lead.frequence),
  objectif: lisible('objectif', lead.objectif),
  budget_equipement: lisible('budget', lead.budget),
};

return {
  requete: {
    model: config.modele,
    max_tokens: 1000,
    thinking: { type: 'disabled' },
    system: consignes,
    messages: [{ role: 'user', content: 'Profil du nouvel inscrit :\n' + JSON.stringify(profil, null, 1) }],
  },
};
