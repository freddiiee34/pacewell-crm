// Configuration du workflow « Qualification ».
// C'est le seul nœud à modifier après l'import : renseigne les ID des listes
// Brevo affichés par scripts/setup_brevo.py.
const config = {
  marque: 'Pacewell',
  modele: 'claude-haiku-5-5',
  // Tarifs Claude Haiku 5.5 (USD par million de tokens, prompts < 100k tokens).
  // Source : platform.claude.com/docs/en/about-claude/pricing — à revérifier de temps en temps.
  prixEntreeParMillion: 0.10,
  prixSortieParMillion: 0.50,
  seuilLeadChaud: 70,
  emailAlerte: 'simon59117@gmail.com',
  // Alertes et validations (vers toi) / emails aux inscrits (au nom de la marque).
  expediteur: { email: 'audit@simondelrue.fr', name: 'Pacewell CRM' },
  expediteurMarque: { email: 'audit@simondelrue.fr', name: 'Pacewell' },
  urlSite: 'https://pacewell.simondelrue.fr',
  urlN8n: 'https://n8n.simondelrue.fr',
  // Réactivation : inactif depuis N jours, au plus M propositions par passage.
  joursInactivite: 60,
  maxRelances: 5,
  delaiDoublonJours: 7,
  // Adresses des API (modifiables pour les tests).
  urlBrevo: 'https://api.brevo.com/v3',
  urlClaude: 'https://api.anthropic.com/v1',
  listes: {
    ROUTE_DEBUTANT: 0,
    ROUTE_PERF: 0,
    TRAIL_DECOUVERTE: 0,
    TRAIL_ENDURANCE: 0,
    A_QUALIFIER: 0,
  },
};

// Le webhook range le formulaire dans `body` et les paramètres d'URL dans `query`.
return { formulaire: $json.body ?? {}, query: $json.query ?? {}, config };
