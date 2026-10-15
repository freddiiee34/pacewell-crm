// ---- Outils communs (ajoutés en tête des nœuds 08 et suivants par construire_workflow.py) ----
// Un nœud Code de n8n ne peut pas importer de fichier : ce bloc est recopié dans chacun.
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const SEGMENTS_LIBELLES = {
  ROUTE_DEBUTANT: 'Route · Débuter', ROUTE_PERF: 'Route · Performance',
  TRAIL_DECOUVERTE: 'Trail · Découverte', TRAIL_ENDURANCE: 'Trail · Endurance et ultra', A_QUALIFIER: 'À qualifier',
};
const NIVEAUX_LIBELLES = { debutant: 'Débutant', intermediaire: 'Intermédiaire', confirme: 'Confirmé' };
const REPONSES_LIBELLES = {
  pratique: { route: 'Route', trail: 'Trail', 'les-deux': 'Route et trail' },
  frequence: { 'moins-1': 'Moins d\'une sortie par semaine', '1-2': '1 à 2 sorties par semaine', '3-4': '3 à 4 sorties par semaine', '5-plus': '5 sorties ou plus par semaine' },
  objectif: { forme: 'Garder la forme', '10km': '10 km', semi: 'Semi-marathon', marathon: 'Marathon', 'trail-court': 'Trail court', ultra: 'Ultra-trail' },
  budget: { 'moins-150': 'Moins de 150 € par an', '150-400': '150 à 400 € par an', '400-plus': 'Plus de 400 € par an' },
};
const lisible = (champ, v) => REPONSES_LIBELLES[champ]?.[v] ?? v ?? '—';

// Ce que l'IA n'a pas le droit d'écrire au nom de la marque : prix, promotions, liens,
// adresses, emoji, promesses de santé. Un texte qui en contient est remplacé par le modèle.
const INTERDITS = [
  [/https?:|www\.|\.(fr|com)\b/i, 'lien'],
  [/@/, 'adresse email'],
  [/€|\d\s*%|\beuros?\b/i, 'prix ou pourcentage'],
  [/promo|réduc|remise|solde|offert|gratuit|cadeau/i, 'promotion'],
  [/guéri|médic|traitement/i, 'promesse de santé'],
  [/\p{Extended_Pictographic}/u, 'emoji'],
];
function problemeTexte(texte, max) {
  if (typeof texte !== 'string' || !texte.trim()) return 'texte vide';
  if (texte.length > max) return `texte trop long (${texte.length} > ${max})`;
  for (const [motif, nom] of INTERDITS) if (motif.test(texte)) return nom;
  return null;
}

// Lit le JSON d'une réponse Claude (réponse HTTP complète de n8n) et calcule son coût.
function lireClaude(reponse, config) {
  const corps = reponse.body || {};
  const usage = corps.usage || {};
  const cout = ((usage.input_tokens || 0) * config.prixEntreeParMillion
    + (usage.output_tokens || 0) * config.prixSortieParMillion) / 1e6;
  const arrondi = Math.round(cout * 1e6) / 1e6;
  if (reponse.statusCode !== 200) return { erreur: `API ${reponse.statusCode || 'injoignable'}`, cout: arrondi };
  const texte = (corps.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { donnees: JSON.parse(texte.slice(texte.indexOf('{'), texte.lastIndexOf('}') + 1)), cout: arrondi };
  } catch (err) {
    return { erreur: 'JSON illisible', cout: arrondi };
  }
}

// Jeton aléatoire pour les liens de validation (usage unique, stocké dans Brevo).
function jeton() {
  const octets = new Uint8Array(18);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(octets);
  else for (let i = 0; i < octets.length; i++) octets[i] = Math.floor(Math.random() * 256);
  return Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('');
}

// Gabarit HTML des emails de la marque : tableaux et styles en ligne (Gmail, Outlook, mobile).
const COULEURS = { encre: '#10213a', craie: '#e8ebee', piste: '#ff5a1f', gris: '#5b6676', filet: '#dde1e6' };
function gabaritEmail({ marque, etiquette, preheader, corps, pied }) {
  const C = COULEURS;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(marque)}</title></head>
<body style="margin:0;padding:0;background:${C.craie}">
<div style="display:none;max-height:0;overflow:hidden">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.craie}">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:6px;overflow:hidden;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:${C.encre}">
      <tr><td style="background:${C.encre};padding:18px 28px">
        <span style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.3px">${e(marque.toLowerCase())}</span>
        ${etiquette ? `<span style="font-size:13px;color:#aab4c3;padding-left:10px">${e(etiquette)}</span>` : ''}
      </td></tr>
${corps}
      <tr><td style="padding:14px 28px;background:#f4f6f8;font-size:12px;line-height:1.5;color:${C.gris}">${pied}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
const paragraphe = (texte, style = '') => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;${style}">${e(texte)}</p>`;
function bouton(libelle, lien, couleur = COULEURS.piste) {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${couleur};border-radius:4px"><a href="${e(lien)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">${e(libelle)}</a></td>
        </tr></table>`;
}
const PIED_DEMO = (marque) => `${e(marque)} est une marque fictive : cet email fait partie d'une démonstration de Simon Delrue, développeur web &amp; IA. Pour supprimer tes données, réponds simplement à cet email.`;
// ---- Fin des outils communs ----
