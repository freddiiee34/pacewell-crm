// Email d'alerte « lead chaud », envoyé via l'API transactionnelle Brevo.
const { lead, qualification: q } = $('Préparer Brevo').item.json;
const { config } = $('Configuration').item.json;
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const lignes = [
  ['Prénom', lead.prenom], ['Email', lead.email], ['Segment', q.segment], ['Niveau', q.niveau],
  ['Score', `${q.score}/100`], ['Pourquoi', q.raison], ['Pratique', lead.pratique],
  ['Sorties/semaine', lead.frequence], ['Objectif', lead.objectif], ['Budget annuel', lead.budget],
].map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#6e6e73">${e(k)}</td><td style="padding:6px 0">${e(v)}</td></tr>`).join('');

return {
  email: {
    sender: config.expediteur,
    to: [{ email: config.emailAlerte }],
    replyTo: { email: lead.email },
    subject: `🔥 Lead chaud ${config.marque} : ${lead.prenom || lead.email} (${q.score}/100)`,
    htmlContent: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1d1d1f">
<h2 style="margin:0 0 12px">Nouveau lead chaud : ${q.score}/100</h2>
<table style="font-size:15px;border-collapse:collapse">${lignes}</table>
<p style="color:#6e6e73;font-size:13px">Répondre à cet email écrit directement au lead.</p></div>`,
    tags: ['pacewell-alerte'],
  },
};
