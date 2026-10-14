// Valide la réponse de Claude. Garde-fou principal du workflow :
// toute réponse absente, illisible ou incohérente envoie le contact
// dans le segment par défaut A_QUALIFIER, avec la raison du repli.
const SEGMENTS = ['ROUTE_DEBUTANT', 'ROUTE_PERF', 'TRAIL_DECOUVERTE', 'TRAIL_ENDURANCE'];
const NIVEAUX = ['debutant', 'intermediaire', 'confirme'];
const { lead } = $('Dédoublonner').item.json;
const { config } = $('Configuration').item.json;

const repli = (motif, cout = 0) => ({
  lead,
  qualification: {
    segment: 'A_QUALIFIER', niveau: '', score: 0,
    raison: `Qualification automatique impossible (${motif}).`,
    source: 'repli', cout_usd: cout,
  },
});

const statut = $json.statusCode;
const corps = $json.body || {};
const usage = corps.usage || {};
const cout = ((usage.input_tokens || 0) * config.prixEntreeParMillion
  + (usage.output_tokens || 0) * config.prixSortieParMillion) / 1e6;

if (statut !== 200) {
  return repli(`API ${statut || 'injoignable'}`, 0);
}

const texte = (corps.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
let r;
try {
  const debut = texte.indexOf('{');
  const fin = texte.lastIndexOf('}');
  r = JSON.parse(texte.slice(debut, fin + 1));
} catch (e) {
  return repli('JSON illisible', cout);
}

const score = Number(r.score);
if (!SEGMENTS.includes(r.segment)) return repli('segment inconnu', cout);
if (!NIVEAUX.includes(r.niveau)) return repli('niveau inconnu', cout);
if (!Number.isInteger(score) || score < 1 || score > 100) return repli('score hors bornes', cout);
if (typeof r.raison !== 'string' || !r.raison.trim()) return repli('raison absente', cout);
// Cohérence avec les réponses : l'IA ne peut pas classer un coureur sur route dans le trail.
if (lead.pratique === 'route' && !r.segment.startsWith('ROUTE')) return repli('segment incohérent', cout);
if (lead.pratique === 'trail' && !r.segment.startsWith('TRAIL')) return repli('segment incohérent', cout);

return {
  lead,
  qualification: {
    segment: r.segment, niveau: r.niveau, score,
    raison: r.raison.trim().slice(0, 250),
    source: 'ia', cout_usd: Math.round(cout * 1e6) / 1e6,
  },
};
