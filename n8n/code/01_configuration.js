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
  emailAlerte: 'simondelruepro@gmail.com',
  expediteur: { email: 'audit@simondelrue.fr', name: 'Pacewell CRM' },
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

// Le webhook range le formulaire dans `body`.
return { formulaire: $json.body ?? {}, config };
