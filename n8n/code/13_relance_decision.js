// Étape 3 : traite un clic sur « Envoyer » ou « Ignorer » dans l'email de validation.
// - Ouverture du lien (GET) : affiche une page de confirmation, ne fait rien d'autre.
//   Les antivirus de messagerie qui « visitent » les liens ne peuvent donc rien déclencher.
// - Confirmation (POST du formulaire) : envoie ou écarte la relance, une seule fois.
// Entrée : la fiche Brevo du contact (réponse HTTP complète).
const { config, formulaire, query } = $('Configuration').item.json;
const confirmation = Boolean(formulaire && formulaire.decision);
const p = confirmation ? formulaire : (query || {});
const email = String(p.email || '').trim().toLowerCase();
const action = p.action === 'envoyer' || p.action === 'ignorer' ? p.action : null;
const a = ($json.statusCode === 200 && $json.body && $json.body.attributes) || {};
const C = COULEURS;

function page(titre, contenu) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${e(titre)} · ${e(config.marque)}</title>
<style>
  body{margin:0;background:${C.craie};color:${C.encre};font:16px/1.55 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif}
  main{max-width:560px;margin:32px auto;padding:0 16px}
  .carte{background:#fff;border-radius:6px;overflow:hidden}
  .tete{background:${C.encre};color:#fff;padding:16px 24px;font-weight:800}
  .corps{padding:24px}
  h1{font-size:24px;line-height:1.25;margin:0 0 10px}
  .note{color:${C.gris};font-size:14px}
  .apercu{border:1px solid ${C.filet};border-radius:6px;padding:16px;margin:18px 0}
  button{font:inherit;font-weight:700;border:0;border-radius:4px;padding:13px 22px;color:#fff;background:${C.piste};cursor:pointer}
  button.neutre{background:${C.gris}}
  button:focus-visible{outline:3px solid ${C.encre};outline-offset:2px}
</style></head><body><main><div class="carte"><div class="tete">${e(config.marque.toLowerCase())} · Validation CRM</div>
<div class="corps">${contenu}</div></div></main></body></html>`;
}
const resultat = (statut, titre, texte, extra = {}) => ({ action: statut, page: page(titre, `<h1>${e(titre)}</h1><p>${e(texte)}</p>`), ...extra });

if (!email || !action || !p.jeton) {
  return resultat('erreur', 'Lien incomplet', 'Ce lien ne contient pas toutes les informations. Ouvre-le depuis l\'email de validation.');
}
if (!a.RELANCE_JETON || a.RELANCE_JETON !== p.jeton) {
  const deja = { envoyee: 'a déjà été envoyée', ignoree: 'a déjà été écartée' }[a.RELANCE_STATUT];
  return resultat('erreur', deja ? 'Déjà traité' : 'Lien expiré',
    deja ? `Cette relance ${deja}. Rien n'a été modifié.` : 'Ce lien n\'est plus valable : la relance a été remplacée ou supprimée.');
}

const prenom = a.PRENOM || '';
const objet = a.RELANCE_OBJET || '';
const message = sansSalutation(a.RELANCE_MESSAGE || '');
const paragraphes = message.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);

if (!confirmation) {
  const envoyer = action === 'envoyer';
  return {
    action: 'afficher',
    page: page(envoyer ? 'Confirmer l\'envoi' : 'Écarter la relance', `
      <h1>${envoyer ? `Envoyer cette relance à ${e(prenom || email)} ?` : `Écarter la relance pour ${e(prenom || email)} ?`}</h1>
      <p class="note">${e(email)} · ${e(SEGMENTS_LIBELLES[a.SEGMENT] ?? a.SEGMENT ?? '')}</p>
      <div class="apercu"><strong>${e(objet)}</strong>${paragraphes.map((t) => `<p>${e(t)}</p>`).join('')}</div>
      <form method="post" action="${e(config.urlN8n)}/webhook/pacewell-relance-decision">
        <input type="hidden" name="email" value="${e(email)}">
        <input type="hidden" name="jeton" value="${e(p.jeton)}">
        <input type="hidden" name="action" value="${action}">
        <input type="hidden" name="decision" value="1">
        <button type="submit"${envoyer ? '' : ' class="neutre"'}>${envoyer ? 'Oui, envoyer' : 'Oui, écarter'}</button>
      </form>
      <p class="note">${envoyer ? 'L\'email part immédiatement, une seule fois.' : 'L\'inscrit ne recevra rien. Il pourra être reproposé au prochain cycle.'}</p>`),
  };
}

const finir = { RELANCE_JETON: '', RELANCE_STATUT: action === 'envoyer' ? 'envoyee' : 'ignoree', RELANCE_LE: aujourdhui() };
if (action === 'ignorer') {
  return resultat('ignorer', 'Relance écartée', `${prenom || email} ne recevra rien.`, { majContact: { attributes: finir }, email });
}

// Email de relance envoyé à l'inscrit, au nom de la marque.
const corps = `
      <tr><td style="padding:30px 28px 8px">
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25">${e(prenom ? `Salut ${prenom},` : 'Salut,')}</h1>
        ${paragraphes.map((t) => paragraphe(t)).join('')}
      </td></tr>
      <tr><td style="padding:10px 28px 28px">${bouton('Revenir sur ' + config.marque, config.urlSite)}</td></tr>`;

return resultat('envoyer', 'Relance envoyée', `L'email part vers ${prenom || email}.`, {
  majContact: { attributes: finir },
  email,
  emailContact: {
    sender: config.expediteurMarque,
    to: [{ email, ...(prenom ? { name: prenom } : {}) }],
    replyTo: { email: config.emailAlerte },
    subject: objet,
    htmlContent: gabaritEmail({ marque: config.marque, preheader: paragraphes[0] || objet, corps, pied: PIED_DEMO(config.marque) }),
    textContent: [prenom ? `Salut ${prenom},` : 'Salut,', '', ...paragraphes.flatMap((t) => [t, '']), `${config.marque} : ${config.urlSite}`].join('\n'),
    tags: ['pacewell-relance'],
  },
});
