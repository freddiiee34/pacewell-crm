// Tests du code des nœuds n8n, exécuté hors de n8n.
// Lancer : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const charger = (nom) => readFileSync(new URL(`../n8n/code/${nom}`, import.meta.url), 'utf8');

// Exécute le code d'un nœud comme n8n en mode « une fois par élément ».
function executer(nom, json, autres = {}) {
  const $ = (noeud) => {
    if (!(noeud in autres)) throw new Error(`Nœud non simulé : ${noeud}`);
    return { item: { json: autres[noeud] }, first: () => ({ json: autres[noeud] }) };
  };
  return new Function('$json', '$', charger(nom))(json, $);
}

const config = executer('01_configuration.js', {}).config;
config.listes = { ROUTE_DEBUTANT: 11, ROUTE_PERF: 12, TRAIL_DECOUVERTE: 13, TRAIL_ENDURANCE: 14, A_QUALIFIER: 15 };
const CONF = { 'Configuration': { config } };

const FORM = { prenom: ' Julie ', email: 'Julie@Exemple.FR ', pratique: 'trail', frequence: '3-4',
  objectif: 'ultra', budget: '400-plus', consentement: 'oui' };
const LEAD = executer('02_nettoyer.js', { formulaire: FORM }).lead;

const reponseIA = (objet, usage = { input_tokens: 600, output_tokens: 60 }) => ({
  statusCode: 200,
  body: { content: [{ type: 'text', text: typeof objet === 'string' ? objet : JSON.stringify(objet) }], usage },
});
const valider = (rep, lead = LEAD) => executer('05_valider_ia.js', rep, { ...CONF, 'Dédoublonner': { lead } });

// --- Nettoyage -------------------------------------------------------------

test('nettoyage : email en minuscules, espaces retirés, consentement lu', () => {
  assert.equal(LEAD.email, 'julie@exemple.fr');
  assert.equal(LEAD.prenom, 'Julie');
  assert.equal(LEAD.consentement, true);
});

test('nettoyage : refuse spam, email invalide, consentement absent, choix inconnu', () => {
  assert.equal(executer('02_nettoyer.js', { formulaire: { ...FORM, site_web: 'x' } }).erreur, 'spam');
  assert.match(executer('02_nettoyer.js', { formulaire: { ...FORM, email: 'julie' } }).erreur, /email/);
  assert.match(executer('02_nettoyer.js', { formulaire: { ...FORM, consentement: '' } }).erreur, /consentement/);
  assert.match(executer('02_nettoyer.js', { formulaire: { ...FORM, objectif: 'triathlon' } }).erreur, /objectif/);
});

test('nettoyage : balises retirées du prénom', () => {
  const r = executer('02_nettoyer.js', { formulaire: { ...FORM, prenom: '<script>Jo</script>' } });
  assert.ok(!/[<>]/.test(r.lead.prenom));
});

// --- Dédoublonnage ---------------------------------------------------------

const dedup = (reponseBrevo) => executer('03_dedoublonner.js', reponseBrevo,
  { ...CONF, 'Nettoyer et valider': { lead: LEAD } });

test('dédoublonnage : nouveau contact (404) → qualification', () => {
  const r = dedup({ statusCode: 404, body: {} });
  assert.equal(r.doublon, false);
  assert.equal(r.existant, false);
});

test('dédoublonnage : mêmes réponses qualifiées récemment → pas de nouvel appel IA', () => {
  const attributes = { PRATIQUE: 'trail', FREQUENCE: '3-4', OBJECTIF: 'ultra', BUDGET: '400-plus',
    SEGMENT: 'TRAIL_ENDURANCE', NIVEAU: 'confirme', SCORE: 88, QUALIFIE_LE: new Date().toISOString().slice(0, 10) };
  const r = dedup({ statusCode: 200, body: { attributes } });
  assert.equal(r.doublon, true);
  assert.equal(r.qualification.segment, 'TRAIL_ENDURANCE');
});

test('dédoublonnage : réponses changées → requalification', () => {
  const attributes = { PRATIQUE: 'route', FREQUENCE: '1-2', OBJECTIF: '10km', BUDGET: 'moins-150',
    SEGMENT: 'ROUTE_DEBUTANT', QUALIFIE_LE: new Date().toISOString().slice(0, 10) };
  const r = dedup({ statusCode: 200, body: { attributes } });
  assert.equal(r.doublon, false);
  assert.equal(r.existant, true);
});

// --- Prompt -------------------------------------------------------------------

test("prompt : l'IA ne reçoit ni l'email ni le prénom", () => {
  const { requete } = executer('04_preparer_prompt.js', { lead: LEAD }, CONF);
  const tout = JSON.stringify(requete);
  assert.ok(!tout.includes('julie@exemple.fr'));
  assert.ok(!tout.includes('Julie'));
  assert.equal(requete.model, 'claude-haiku-5-5');
  assert.deepEqual(requete.thinking, { type: 'disabled' });
});

// --- Validation de la réponse IA ----------------------------------------------

test('validation : réponse correcte acceptée, coût calculé', () => {
  const r = valider(reponseIA({ segment: 'TRAIL_ENDURANCE', niveau: 'confirme', score: 88, raison: 'Ultra, 4 sorties, gros budget.' }));
  assert.equal(r.qualification.source, 'ia');
  assert.equal(r.qualification.score, 88);
  // 600 × 0,10 $/M + 60 × 0,50 $/M = 0,00009 $
  assert.equal(r.qualification.cout_usd, 0.00009);
});

test('validation : JSON entouré de texte ou de ```json toléré', () => {
  const r = valider(reponseIA('```json\n{"segment":"TRAIL_DECOUVERTE","niveau":"debutant","score":30,"raison":"ok"}\n```'));
  assert.equal(r.qualification.segment, 'TRAIL_DECOUVERTE');
});

for (const [nom, rep, motif] of [
  ['API en erreur', { statusCode: 529, body: {} }, 'API 529'],
  ['API injoignable', { body: {} }, 'injoignable'],
  ['texte non JSON', reponseIA('Je ne peux pas répondre.'), 'JSON illisible'],
  ['segment inventé', reponseIA({ segment: 'VIP', niveau: 'confirme', score: 90, raison: 'x' }), 'segment inconnu'],
  ['score hors bornes', reponseIA({ segment: 'TRAIL_ENDURANCE', niveau: 'confirme', score: 140, raison: 'x' }), 'score'],
  ['score non entier', reponseIA({ segment: 'TRAIL_ENDURANCE', niveau: 'confirme', score: 'élevé', raison: 'x' }), 'score'],
  ['niveau inconnu', reponseIA({ segment: 'TRAIL_ENDURANCE', niveau: 'pro', score: 80, raison: 'x' }), 'niveau'],
  ['raison vide', reponseIA({ segment: 'TRAIL_ENDURANCE', niveau: 'confirme', score: 80, raison: ' ' }), 'raison'],
  ['trail classé en route', reponseIA({ segment: 'ROUTE_PERF', niveau: 'confirme', score: 80, raison: 'x' }), 'incohérent'],
]) {
  test(`validation : repli sur A_QUALIFIER si ${nom}`, () => {
    const r = valider(rep);
    assert.equal(r.qualification.segment, 'A_QUALIFIER');
    assert.equal(r.qualification.source, 'repli');
    assert.match(r.qualification.raison, new RegExp(motif));
  });
}

test('validation : « les-deux » peut aller en route comme en trail', () => {
  const lead = { ...LEAD, pratique: 'les-deux' };
  const r = valider(reponseIA({ segment: 'ROUTE_PERF', niveau: 'intermediaire', score: 60, raison: 'Marathon.' }), lead);
  assert.equal(r.qualification.segment, 'ROUTE_PERF');
});

// --- Brevo et alerte -------------------------------------------------------

test('Brevo : liste du segment ajoutée, autres listes retirées', () => {
  const q = { segment: 'TRAIL_ENDURANCE', niveau: 'confirme', score: 88, raison: 'r', source: 'ia', cout_usd: 0.00009 };
  const r = executer('06_preparer_brevo.js', { lead: LEAD, qualification: q }, CONF);
  assert.deepEqual(r.contact.listIds, [14]);
  assert.deepEqual(r.contact.unlinkListIds.sort(), [11, 12, 13, 15]);
  assert.equal(r.contact.updateEnabled, true);
  assert.equal(r.contact.attributes.SEGMENT, 'TRAIL_ENDURANCE');
  assert.equal(r.leadChaud, true);
});

test('Brevo : un score sous le seuil ne déclenche pas d\'alerte', () => {
  const q = { segment: 'ROUTE_DEBUTANT', niveau: 'debutant', score: 25, raison: 'r', source: 'ia', cout_usd: 0 };
  assert.equal(executer('06_preparer_brevo.js', { lead: LEAD, qualification: q }, CONF).leadChaud, false);
});

test("alerte : contenu échappé, réponse directe au lead", () => {
  const lead = { ...LEAD, prenom: 'Jo<b>' };
  const q = { segment: 'TRAIL_ENDURANCE', niveau: 'confirme', score: 88, raison: 'a & b', source: 'ia' };
  const r = executer('07_alerte.js', {}, { ...CONF, 'Préparer Brevo': { lead, qualification: q } });
  assert.ok(r.email.htmlContent.includes('Jo&lt;b&gt;'));
  assert.ok(r.email.htmlContent.includes('a &amp; b'));
  assert.equal(r.email.replyTo.email, 'julie@exemple.fr');
  assert.equal(r.email.to[0].email, 'simon59117@gmail.com');
});

test("alerte : objet sans emoji, version texte, réponses lisibles", () => {
  const q = { segment: 'TRAIL_ENDURANCE', niveau: 'confirme', score: 88, raison: 'Ultra.', source: 'ia' };
  const r = executer('07_alerte.js', {}, { ...CONF, 'Préparer Brevo': { lead: { ...LEAD, objectif: 'ultra', budget: '400-plus' }, qualification: q } });
  assert.match(r.email.subject, /^Lead chaud .+ \(88\/100\)$/);
  assert.doesNotMatch(r.email.subject, /\p{Extended_Pictographic}/u);
  assert.ok(r.email.textContent.includes('Score : 88/100'));
  assert.ok(r.email.textContent.includes('Trail · Endurance et ultra'));
  assert.ok(r.email.htmlContent.includes('Plus de 400 €'));
  assert.ok(r.email.htmlContent.includes('width:88%'));
});
