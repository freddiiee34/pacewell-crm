// Dédoublonnage. Entrée : la réponse brute de Brevo (GET /contacts/{email}).
// - Nouveau contact (404) : on qualifie.
// - Contact déjà qualifié avec les mêmes réponses il y a moins de N jours :
//   on ne rappelle pas l'IA (économie de coût), on réutilise sa qualification.
// - Sinon (réponses changées ou qualification ancienne) : on requalifie.
const { lead } = $('Nettoyer et valider').item.json;
const { config } = $('Configuration').item.json;
const statut = $json.statusCode;
const contact = statut === 200 ? ($json.body || {}) : null;
const a = (contact && contact.attributes) || {};

const memesReponses = contact
  && a.PRATIQUE === lead.pratique && a.FREQUENCE === lead.frequence
  && a.OBJECTIF === lead.objectif && a.BUDGET === lead.budget;
const qualifieLe = a.QUALIFIE_LE ? new Date(a.QUALIFIE_LE) : null;
const recent = qualifieLe && (Date.now() - qualifieLe.getTime()) < config.delaiDoublonJours * 86400000;

if (memesReponses && recent && a.SEGMENT && a.SEGMENT !== 'A_QUALIFIER') {
  return {
    lead,
    doublon: true,
    existant: true,
    qualification: {
      segment: a.SEGMENT, niveau: a.NIVEAU, score: Number(a.SCORE) || 0,
      raison: a.RAISON_IA || '', source: 'doublon', cout_usd: 0,
    },
  };
}
return { lead, doublon: false, existant: Boolean(contact) };
