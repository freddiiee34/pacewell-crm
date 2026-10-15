// Étape 2 : vérifie le texte de l'IA et compose l'email de bienvenue.
// Si l'IA est en panne ou écrit quelque chose d'interdit, un modèle rédigé à la main
// pour le segment prend le relais : l'inscrit reçoit toujours un email correct.
const { lead, qualification: q } = $('Préparer Brevo').item.json;
const { config } = $('Configuration').item.json;

const MODELES = {
  ROUTE_DEBUTANT: {
    objet: 'Bienvenue : on court ensemble ?',
    intro: 'Bienvenue dans la communauté. Reprendre ou débuter la course, c\'est surtout trouver un rythme qui tient dans la durée.',
    conseils: [
      'Alterne marche et course sur tes premières sorties : la régularité compte plus que la distance.',
      'Garde une allure où tu peux parler : c\'est elle qui construit ton endurance.',
      'Laisse au moins un jour de repos entre deux sorties au début.',
    ],
    selection: 'Commence par une paire de chaussures de route amortie, adaptée à ta foulée : c\'est l\'équipement qui compte le plus.',
  },
  ROUTE_PERF: {
    objet: 'Bienvenue : préparons ton prochain chrono',
    intro: 'Bienvenue. Tu as un objectif chronométré en tête, alors on va t\'aider à arriver frais et prêt le jour J.',
    conseils: [
      'Garde une sortie longue par semaine, à allure facile : elle construit ta base.',
      'Ajoute une séance de fractionné court pour gagner en vitesse sans t\'épuiser.',
      'Teste ta tenue et ton ravitaillement à l\'entraînement, jamais pour la première fois en course.',
    ],
    selection: 'Regarde une paire de chaussures légères et dynamiques pour les séances rapides, en plus de ta paire d\'entraînement.',
  },
  TRAIL_DECOUVERTE: {
    objet: 'Bienvenue sur les sentiers',
    intro: 'Bienvenue. Le trail, c\'est la course avec du relief et du paysage : on t\'accompagne pour tes premiers sentiers.',
    conseils: [
      'Marche dans les montées raides : tout le monde le fait, même les meilleurs.',
      'Regarde deux ou trois mètres devant toi dans les descentes pour anticiper tes appuis.',
      'Pars toujours avec de l\'eau, même pour une sortie d\'une heure.',
    ],
    selection: 'Une paire de chaussures de trail avec une bonne accroche changera tes sorties plus que tout le reste.',
  },
  TRAIL_ENDURANCE: {
    objet: 'Bienvenue : cap sur les longues distances',
    intro: 'Bienvenue. Tu vises les longues distances : on va parler gestion d\'effort, matériel fiable et récupération.',
    conseils: [
      'Entraîne-toi à manger en courant lors de tes sorties longues, ton estomac aussi s\'entraîne.',
      'Ajoute du dénivelé régulièrement, en montée comme en descente.',
      'Prévois une semaine plus légère toutes les trois ou quatre semaines pour bien assimiler.',
    ],
    selection: 'Regarde en priorité un sac d\'hydratation confortable et des chaussures de trail amorties pour les longues heures.',
  },
};
MODELES.A_QUALIFIER = { ...MODELES.ROUTE_DEBUTANT, objet: `Bienvenue chez ${config.marque}` };

// Vérification du texte proposé par l'IA.
const ia = lireClaude($json, config);
let contenu = ia.donnees;
let motif = ia.erreur || null;
if (!motif) {
  const c = contenu;
  motif = problemeTexte(c.objet, 70) || problemeTexte(c.intro, 320) || problemeTexte(c.selection, 240)
    || (!Array.isArray(c.conseils) || c.conseils.length !== 3 ? 'il faut 3 conseils' : null)
    || c.conseils.map((t) => problemeTexte(t, 200)).find(Boolean) || null;
}
const source = motif ? 'modele' : 'ia';
if (motif) contenu = MODELES[q.segment] || MODELES.A_QUALIFIER;
contenu = { ...contenu, intro: sansSalutation(contenu.intro) };

const prenom = lead.prenom || '';
const C = COULEURS;
const puces = contenu.conseils.map((t) => `
            <tr>
              <td style="width:22px;vertical-align:top;padding:4px 0"><span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:${C.piste}"></span></td>
              <td style="padding:0 0 12px;font-size:15px;line-height:1.5">${e(t.trim())}</td>
            </tr>`).join('');

const corps = `
      <tr><td style="padding:30px 28px 6px">
        <h1 style="margin:0 0 14px;font-size:26px;line-height:1.2">${e(prenom ? `Salut ${prenom},` : 'Salut,')}</h1>
        ${paragraphe(contenu.intro.trim())}
        <p style="margin:0;font-size:13px;color:${C.gris}">Ton profil : <strong style="color:${C.encre}">${e(SEGMENTS_LIBELLES[q.segment] ?? 'Coureur')}</strong></p>
      </td></tr>
      <tr><td style="padding:18px 28px 6px">
        <p style="margin:0 0 12px;font-size:17px;font-weight:800">Trois conseils pour tes prochaines sorties</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${puces}
        </table>
      </td></tr>
      <tr><td style="padding:6px 28px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.craie};border-left:4px solid ${C.piste};border-radius:4px">
          <tr><td style="padding:14px 16px;font-size:15px;line-height:1.5">
            <span style="display:block;font-size:12px;font-weight:700;color:${C.gris};padding-bottom:4px">Notre conseil équipement</span>${e(contenu.selection.trim())}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:22px 28px 28px">
        ${bouton('Voir la sélection', config.urlSite)}
      </td></tr>`;

const htmlContent = gabaritEmail({
  marque: config.marque,
  preheader: contenu.intro.trim(),
  corps,
  pied: PIED_DEMO(config.marque),
});
const textContent = [
  prenom ? `Salut ${prenom},` : 'Salut,',
  '',
  contenu.intro.trim(),
  '',
  'Trois conseils pour tes prochaines sorties :',
  ...contenu.conseils.map((t) => `- ${t.trim()}`),
  '',
  `Notre conseil équipement : ${contenu.selection.trim()}`,
  '',
  `Voir la sélection : ${config.urlSite}`,
  '',
  `${config.marque} est une marque fictive : cet email fait partie d'une démonstration de Simon Delrue. Pour supprimer tes données, réponds à cet email.`,
].join('\n');

return {
  bienvenue: { source, motif, cout_usd: ia.cout },
  email: {
    sender: config.expediteurMarque,
    to: [{ email: lead.email, ...(prenom ? { name: prenom } : {}) }],
    replyTo: { email: config.emailAlerte },
    subject: contenu.objet.trim(),
    htmlContent,
    textContent,
    tags: ['pacewell-bienvenue'],
  },
};
