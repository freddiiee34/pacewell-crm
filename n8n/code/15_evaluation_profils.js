// Évaluation : produit un élément par profil annoté (mode « une fois pour tous les éléments »).
// La liste est injectée depuis evaluation/profils.json par construire_workflow.py.
const PROFILS = __PROFILS__;
return PROFILS.map((p) => ({
  json: {
    profil: p,
    lead: { email: 'evaluation@exemple.fr', prenom: '', pratique: p.pratique, frequence: p.frequence, objectif: p.objectif, budget: p.budget },
  },
}));
