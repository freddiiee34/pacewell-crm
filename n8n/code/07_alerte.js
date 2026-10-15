// Email d'alerte « lead chaud », envoyé via l'API transactionnelle Brevo.
// Mise en page en tableaux et styles en ligne (compatible Gmail, Outlook, mobile),
// version texte jointe, objet sans emoji pour une meilleure délivrabilité.
const { lead, qualification: q } = $('Préparer Brevo').item.json;
const { config } = $('Configuration').item.json;
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SEGMENTS = {
  ROUTE_DEBUTANT: 'Route · Débuter', ROUTE_PERF: 'Route · Performance',
  TRAIL_DECOUVERTE: 'Trail · Découverte', TRAIL_ENDURANCE: 'Trail · Endurance et ultra', A_QUALIFIER: 'À qualifier',
};
const NIVEAUX = { debutant: 'Débutant', intermediaire: 'Intermédiaire', confirme: 'Confirmé' };
const REPONSES = {
  pratique: { route: 'Route', trail: 'Trail', 'les-deux': 'Route et trail' },
  frequence: { 'moins-1': 'Moins d\'une sortie', '1-2': '1 à 2 sorties', '3-4': '3 à 4 sorties', '5-plus': '5 sorties ou plus' },
  objectif: { forme: 'Garder la forme', '10km': '10 km', semi: 'Semi-marathon', marathon: 'Marathon', 'trail-court': 'Trail court', ultra: 'Ultra' },
  budget: { 'moins-150': 'Moins de 150 €', '150-400': '150 à 400 €', '400-plus': 'Plus de 400 €' },
};
const lisible = (champ, v) => REPONSES[champ]?.[v] ?? v ?? '—';

const nom = lead.prenom || lead.email;
const score = Math.max(0, Math.min(100, Number(q.score) || 0));
const segment = SEGMENTS[q.segment] ?? q.segment;
const niveau = NIVEAUX[q.niveau] ?? q.niveau;
const reponses = [
  ['Pratique', lisible('pratique', lead.pratique)],
  ['Sorties par semaine', lisible('frequence', lead.frequence)],
  ['Objectif', lisible('objectif', lead.objectif)],
  ['Budget équipement par an', lisible('budget', lead.budget)],
];

// Couleurs de la marque : encre, craie, orange piste
const ENCRE = '#10213a', CRAIE = '#e8ebee', PISTE = '#ff5a1f', GRIS = '#5b6676';

const lignes = reponses.map(([k, v]) => `
          <tr>
            <td style="padding:10px 0;border-top:1px solid #dde1e6;font-size:14px;color:${GRIS};width:48%">${e(k)}</td>
            <td style="padding:10px 0;border-top:1px solid #dde1e6;font-size:14px;color:${ENCRE};font-weight:600">${e(v)}</td>
          </tr>`).join('');

const htmlContent = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lead chaud ${e(config.marque)}</title></head>
<body style="margin:0;padding:0;background:${CRAIE}">
<div style="display:none;max-height:0;overflow:hidden">${e(nom)} : ${score}/100, ${e(segment)}. ${e(q.raison)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CRAIE}">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:6px;overflow:hidden;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
      <tr><td style="background:${ENCRE};padding:18px 28px">
        <span style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.3px">${e(config.marque.toLowerCase())}</span>
        <span style="font-size:13px;color:#aab4c3;padding-left:10px">Alerte CRM</span>
      </td></tr>
      <tr><td style="padding:28px 28px 8px">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${PISTE};text-transform:none">Nouveau lead chaud</p>
        <h1 style="margin:0 0 18px;font-size:26px;line-height:1.2;color:${ENCRE}">${e(nom)}</h1>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:44px;font-weight:800;color:${ENCRE};line-height:1;width:120px">${score}<span style="font-size:16px;color:${GRIS};font-weight:600">/100</span></td>
            <td style="vertical-align:bottom;padding-bottom:6px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e3e7ec;border-radius:99px">
                <tr><td style="height:10px;width:${score}%;background:${PISTE};border-radius:99px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:15px;color:${ENCRE}"><strong>${e(segment)}</strong> · ${e(niveau)}</p>
      </td></tr>
      <tr><td style="padding:16px 28px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CRAIE};border-left:4px solid ${PISTE};border-radius:4px">
          <tr><td style="padding:14px 16px;font-size:15px;line-height:1.5;color:${ENCRE}">
            <span style="display:block;font-size:12px;font-weight:700;color:${GRIS};padding-bottom:4px">Pourquoi l'IA le juge chaud</span>${e(q.raison)}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 28px 6px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lignes}
          <tr>
            <td style="padding:10px 0;border-top:1px solid #dde1e6;font-size:14px;color:${GRIS}">Email</td>
            <td style="padding:10px 0;border-top:1px solid #dde1e6;font-size:14px"><a href="mailto:${e(lead.email)}" style="color:${ENCRE}">${e(lead.email)}</a></td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 28px 28px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${PISTE};border-radius:4px"><a href="mailto:${e(lead.email)}?subject=${encodeURIComponent(`Ton profil ${config.marque}`)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">Écrire à ${e(nom)}</a></td>
        </tr></table>
        <p style="margin:14px 0 0;font-size:13px;color:${GRIS}">Tu peux aussi répondre directement à cet email : la réponse part chez le lead.</p>
      </td></tr>
      <tr><td style="padding:14px 28px;background:#f4f6f8;font-size:12px;color:${GRIS}">
        Qualifié automatiquement par l'IA (${e(q.source === 'ia' ? 'Claude Haiku' : 'règle de repli')}). Seuil d'alerte : ${e(config.seuilLeadChaud)}/100.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

const textContent = [
  `Nouveau lead chaud ${config.marque} : ${nom}`,
  `Score : ${score}/100`,
  `Segment : ${segment} (${niveau})`,
  '',
  `Pourquoi : ${q.raison}`,
  '',
  ...reponses.map(([k, v]) => `${k} : ${v}`),
  `Email : ${lead.email}`,
  '',
  'Répondre à cet email écrit directement au lead.',
].join('\n');

return {
  email: {
    sender: config.expediteur,
    to: [{ email: config.emailAlerte }],
    replyTo: { email: lead.email },
    subject: `Lead chaud ${config.marque} : ${nom} (${score}/100)`,
    htmlContent,
    textContent,
    tags: ['pacewell-alerte'],
  },
};
