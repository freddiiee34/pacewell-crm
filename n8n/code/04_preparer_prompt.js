// Prépare la requête envoyée à Claude.
// Minimisation des données (RGPD) : l'IA ne reçoit NI l'email NI le prénom,
// seulement les réponses au questionnaire.
const { lead } = $json;
const { config } = $('Configuration').item.json;

const consignes = `Tu es l'outil de qualification CRM de ${config.marque}, une boutique en ligne de running et de trail.
À partir des réponses d'un nouvel inscrit, tu le classes pour personnaliser ses emails.

Segments possibles (choisis-en exactement un) :
- ROUTE_DEBUTANT : court sur route, débute ou reprend, objectif forme ou 10 km, 2 sorties par semaine maximum.
- ROUTE_PERF : court sur route avec un objectif chronométré (semi, marathon) ou 3 sorties et plus par semaine.
- TRAIL_DECOUVERTE : découvre le trail, objectif forme ou trail court, pratique occasionnelle à régulière.
- TRAIL_ENDURANCE : trail engagé, objectif ultra, ou trail avec 3 sorties et plus par semaine.
Règles : « route » donne toujours un segment ROUTE_*, « trail » toujours un segment TRAIL_*.
Pour « les-deux », l'objectif tranche (trail-court ou ultra : TRAIL_* ; sinon ROUTE_*).

Niveau : debutant, intermediaire ou confirme.
Score de 1 à 100 : potentiel commercial sur un an (fréquence de pratique, budget annuel, ambition de l'objectif).
Repères : moins d'une sortie et budget faible, autour de 15 ; pratique régulière et budget moyen, autour de 50 ;
pratique intensive, budget élevé et objectif ambitieux, au-delà de 80.

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"segment": "...", "niveau": "...", "score": 0, "raison": "une phrase de 25 mots maximum"}`;

const reponses = {
  pratique: lead.pratique,
  sorties_par_semaine: lead.frequence,
  objectif: lead.objectif,
  budget_annuel_equipement_euros: lead.budget,
};

return {
  requete: {
    model: config.modele,
    max_tokens: 600,
    // Tâche courte : pas de réflexion préalable, sinon elle peut consommer tout le budget de tokens.
    thinking: { type: 'disabled' },
    system: consignes,
    messages: [{ role: 'user', content: 'Réponses du formulaire :\n' + JSON.stringify(reponses, null, 1) }],
  },
};
