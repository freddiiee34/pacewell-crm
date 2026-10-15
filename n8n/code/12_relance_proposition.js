// Étape 3 : vérifie la relance proposée par l'IA, la met en attente dans Brevo
// et prépare l'email qui te demande de la valider. Rien ne part vers l'inscrit ici.
const { contact: c } = $('Préparer la relance').item.json;
const { config } = $('Configuration').item.json;

const MODELES = {
  ROUTE_DEBUTANT: { objet: 'Une petite sortie cette semaine ?', message: 'Ça fait un moment ! Et si tu remettais tes chaussures cette semaine, pour une sortie de vingt minutes, sans montre ni objectif ?\n\nLe plus dur, c\'est de passer la porte. Après, la course fait le reste.' },
  ROUTE_PERF: { objet: 'Ton prochain objectif t\'attend', message: 'Ça fait un moment qu\'on ne s\'est pas parlé. Ton prochain chrono se prépare dès maintenant, une sortie facile à la fois.\n\nPourquoi ne pas reprendre cette semaine avec une sortie longue tranquille, pour remettre la machine en route ?' },
  TRAIL_DECOUVERTE: { objet: 'Les sentiers te manquent ?', message: 'Ça fait un moment ! Les sentiers n\'ont pas bougé, et ils sont souvent plus beaux à cette saison.\n\nUne boucle d\'une heure ce week-end, à ton rythme, en marchant dans les montées : ça te dit ?' },
  TRAIL_ENDURANCE: { objet: 'Et ton prochain ultra ?', message: 'Ça fait un moment qu\'on ne s\'est pas parlé. Les longues distances se préparent de loin, et chaque sortie en relief compte.\n\nCe week-end, une sortie longue avec du dénivelé, à allure facile, pour reprendre le fil ?' },
};

const ia = lireClaude($json, config);
let contenu = ia.donnees;
let motif = ia.erreur || null;
if (!motif) {
  motif = problemeTexte(contenu.objet, 70) || problemeTexte(contenu.message, 700)
    || (contenu.angle === undefined ? null : problemeTexte(contenu.angle, 300));
}
const source = motif ? 'modele' : 'ia';
if (motif) contenu = { ...(MODELES[c.segment] || MODELES.ROUTE_DEBUTANT), angle: `Modèle du segment (texte de l'IA écarté : ${motif}).` };

const objet = contenu.objet.trim();
const message = contenu.message.trim();
const cle = jeton();
const lien = (action) => `${config.urlN8n}/webhook/pacewell-relance?email=${encodeURIComponent(c.email)}&jeton=${cle}&action=${action}`;

// Email de validation, envoyé à toi uniquement.
const C = COULEURS;
const corps = `
      <tr><td style="padding:28px 28px 8px">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${C.piste}">Relance à valider</p>
        <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25">${e(c.prenom || c.email)}, sans nouvelles depuis ${c.joursInactif} jours</h1>
        <p style="margin:0;font-size:14px;color:${C.gris}">${e(SEGMENTS_LIBELLES[c.segment] ?? c.segment)} · score ${c.score}/100 · ${e(c.email)}</p>
      </td></tr>
      <tr><td style="padding:16px 28px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.filet};border-radius:6px">
          <tr><td style="padding:16px 18px">
            <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${C.gris}">Objet proposé</p>
            <p style="margin:0 0 14px;font-size:16px;font-weight:700">${e(objet)}</p>
            <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${C.gris}">Message proposé</p>
            ${message.split(/\n\s*\n/).map((p) => paragraphe(p.trim(), 'font-size:15px')).join('')}
          </td></tr>
        </table>
        <p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:${C.gris}"><strong>Pourquoi cet angle :</strong> ${e(contenu.angle || '')} Rédigé par ${source === 'ia' ? 'l\'IA' : 'le modèle du segment'}.</p>
      </td></tr>
      <tr><td style="padding:20px 28px 28px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:10px">${bouton('Envoyer', lien('envoyer'))}</td>
          <td>${bouton('Ignorer', lien('ignorer'), C.gris)}</td>
        </tr></table>
        <p style="margin:12px 0 0;font-size:13px;color:${C.gris}">Chaque bouton ouvre une page de confirmation : rien ne part sans ton accord.</p>
      </td></tr>`;

return {
  contact: c,
  proposition: { objet, message, angle: contenu.angle || '', source, motif, cout_usd: ia.cout },
  majContact: {
    attributes: {
      RELANCE_STATUT: 'proposee', RELANCE_LE: aujourdhui(), RELANCE_JETON: cle,
      RELANCE_OBJET: objet, RELANCE_MESSAGE: message, RELANCE_SOURCE: source,
    },
  },
  emailValidation: {
    sender: config.expediteur,
    to: [{ email: config.emailAlerte }],
    subject: `Relance à valider : ${c.prenom || c.email} (${SEGMENTS_LIBELLES[c.segment] ?? c.segment})`,
    htmlContent: gabaritEmail({ marque: config.marque, etiquette: 'Validation CRM', preheader: `${objet} : ${message.slice(0, 90)}`, corps, pied: 'Proposition générée par le workflow « Réactivation ». Le lien expire dès que tu as décidé.' }),
    textContent: [`Relance à valider pour ${c.prenom || c.email} (${c.email}), sans nouvelles depuis ${c.joursInactif} jours.`, '', `Objet : ${objet}`, '', message, '', `Pourquoi : ${contenu.angle || ''}`, '', `Envoyer : ${lien('envoyer')}`, `Ignorer : ${lien('ignorer')}`].join('\n'),
    tags: ['pacewell-validation'],
  },
};
