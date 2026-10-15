// Prépare la création ou la mise à jour du contact dans Brevo (upsert).
// Le contact est ajouté à la liste de son segment et retiré des autres,
// pour qu'un changement de profil ne le laisse pas dans deux parcours.
const { lead, qualification: q } = $json;
const { config } = $('Configuration').item.json;
const idListe = config.listes[q.segment];
const autres = Object.values(config.listes).filter((id) => id && id !== idListe);

return {
  lead,
  qualification: q,
  contact: {
    email: lead.email,
    updateEnabled: true,
    attributes: {
      PRENOM: lead.prenom,
      PRATIQUE: lead.pratique,
      FREQUENCE: lead.frequence,
      OBJECTIF: lead.objectif,
      BUDGET: lead.budget,
      SEGMENT: q.segment,
      NIVEAU: q.niveau,
      SCORE: q.score,
      RAISON_IA: q.raison,
      SOURCE_QUALIF: q.source,
      COUT_IA_USD: q.cout_usd,
      QUALIFIE_LE: new Date().toISOString().slice(0, 10),
      DERNIERE_ACTIVITE: new Date().toISOString().slice(0, 10),
    },
    listIds: idListe ? [idListe] : [],
    unlinkListIds: autres,
  },
  leadChaud: q.score >= config.seuilLeadChaud,
};
