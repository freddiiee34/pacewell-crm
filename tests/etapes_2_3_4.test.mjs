// Tests des nœuds des étapes 2 (bienvenue), 3 (réactivation) et 4 (statistiques, évaluation).
// Lancer : node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lire = (nom) => readFileSync(new URL(`../n8n/code/${nom}`, import.meta.url), 'utf8');
const COMMUN = lire('_commun.js');

// Exécute un nœud Code comme n8n. `autres` simule les nœuds précédents : objet (un élément)
// ou tableau (plusieurs éléments) ; `entree` simule $input pour le mode « tous les éléments ».
function executer(nom, json, autres = {}, entree = null) {
  const elements = (noeud) => {
    if (!(noeud in autres)) throw new Error(`Nœud non simulé : ${noeud}`);
    const v = autres[noeud];
    return (Array.isArray(v) ? v : [v]).map((j) => ({ json: j }));
  };
  const $ = (noeud) => ({ item: elements(noeud)[0], first: () => elements(noeud)[0], all: () => elements(noeud) });
  const $input = { all: () => (entree || [json]).map((j) => ({ json: j })), first: () => ({ json: (entree || [json])[0] }) };
  const code = (nom.startsWith('0') && Number(nom.slice(0, 2)) < 8 ? '' : COMMUN + '\n') + lire(nom);
  return new Function('$json', '$', '$input', code)(json, $, $input);
}

const config = executer('01_configuration.js', {}).config;
const CONF = { Configuration: { config } };
const LEAD = { email: 'julie@exemple.fr', prenom: 'Julie', pratique: 'trail', frequence: '3-4', objectif: 'ultra', budget: '400-plus' };
const Q = { segment: 'TRAIL_ENDURANCE', niveau: 'confirme', score: 88, raison: 'Ultra.', source: 'ia', cout_usd: 0.00009 };
const BREVO = { ...CONF, 'Préparer Brevo': { lead: LEAD, qualification: Q } };
const claude = (objet, statusCode = 200) => ({
  statusCode,
  body: { content: [{ type: 'text', text: typeof objet === 'string' ? objet : JSON.stringify(objet) }], usage: { input_tokens: 700, output_tokens: 200 } },
});
const BIENVENUE_OK = {
  objet: 'Bienvenue, futur ultra-traileur',
  intro: 'Bienvenue Pacewell ! Trois à quatre sorties et un ultra en ligne de mire : tu es sérieux, on va l\'être aussi.',
  conseils: ['Mange pendant tes sorties longues.', 'Fais du dénivelé chaque semaine.', 'Allège une semaine sur quatre.'],
  selection: 'Un sac d\'hydratation stable et des chaussures amorties pour les longues heures.',
};

// --- Configuration -------------------------------------------------------------

test('configuration : lit le formulaire (POST) et les paramètres d\'URL (GET)', () => {
  const r = executer('01_configuration.js', { body: { a: 1 }, query: { b: 2 } });
  assert.deepEqual(r.formulaire, { a: 1 });
  assert.deepEqual(r.query, { b: 2 });
  assert.equal(r.config.joursInactivite, 60);
});

// --- Étape 2 : bienvenue --------------------------------------------------------

test("bienvenue : l'IA ne reçoit ni le prénom ni l'email", () => {
  const { requete } = executer('08_bienvenue_prompt.js', {}, BREVO);
  const tout = JSON.stringify(requete);
  assert.ok(!tout.includes('Julie') && !tout.includes('julie@'));
  assert.ok(tout.includes('Trail · Endurance et ultra'));
});

test("bienvenue : texte de l'IA accepté, prénom ajouté par le gabarit", () => {
  const r = executer('09_bienvenue_email.js', claude(BIENVENUE_OK), BREVO);
  assert.equal(r.bienvenue.source, 'ia');
  assert.equal(r.email.subject, BIENVENUE_OK.objet);
  assert.equal(r.email.to[0].email, 'julie@exemple.fr');
  assert.ok(r.email.htmlContent.includes('Salut Julie,'));
  assert.ok(r.email.htmlContent.includes('Fais du dénivelé chaque semaine.'));
  assert.ok(r.email.textContent.includes('- Allège une semaine sur quatre.'));
  assert.deepEqual(r.email.tags, ['pacewell-bienvenue']);
  assert.ok(r.bienvenue.cout_usd > 0);
});

for (const [nom, contenu, motif] of [
  ['promotion', { ...BIENVENUE_OK, selection: 'Profite de -20 % avec le code PACE20.' }, /pourcentage|promotion/],
  ['lien', { ...BIENVENUE_OK, intro: 'Va voir www.exemple.com tout de suite.' }, /lien/],
  ['emoji', { ...BIENVENUE_OK, objet: 'Bienvenue 🏃' }, /emoji/],
  ['deux conseils', { ...BIENVENUE_OK, conseils: ['a b c', 'd e f'] }, /3 conseils/],
  ['objet trop long', { ...BIENVENUE_OK, objet: 'x'.repeat(90) }, /trop long/],
]) {
  test(`bienvenue : modèle du segment si l'IA écrit ${nom}`, () => {
    const r = executer('09_bienvenue_email.js', claude(contenu), BREVO);
    assert.equal(r.bienvenue.source, 'modele');
    assert.match(r.bienvenue.motif, motif);
    assert.equal(r.email.subject, 'Bienvenue : cap sur les longues distances');
  });
}

test('bienvenue : modèle si l\'API est en panne', () => {
  const r = executer('09_bienvenue_email.js', { statusCode: 529, body: {} }, BREVO);
  assert.equal(r.bienvenue.source, 'modele');
  assert.match(r.bienvenue.motif, /API 529/);
});

test('bienvenue : les modèles écrits à la main passent eux-mêmes les garde-fous', () => {
  for (const segment of ['ROUTE_DEBUTANT', 'ROUTE_PERF', 'TRAIL_DECOUVERTE', 'TRAIL_ENDURANCE', 'A_QUALIFIER']) {
    const r = executer('09_bienvenue_email.js', { statusCode: 500, body: {} },
      { ...CONF, 'Préparer Brevo': { lead: LEAD, qualification: { ...Q, segment } } });
    const fn = new Function(COMMUN + '\nreturn problemeTexte;')();
    assert.equal(fn(r.email.subject, 70), null, segment);
    assert.equal(fn(r.email.textContent.split('\n')[2], 320), null, segment);
  }
});

test('bienvenue : prénom piégé échappé dans le HTML', () => {
  const r = executer('09_bienvenue_email.js', claude(BIENVENUE_OK), { ...CONF, 'Préparer Brevo': { lead: { ...LEAD, prenom: 'Jo<b>' }, qualification: Q } });
  assert.ok(r.email.htmlContent.includes('Salut Jo&lt;b&gt;,'));
});

// --- Étape 3 : réactivation ---------------------------------------------------------

const ilYa = (jours) => new Date(Date.now() - jours * 86400000).toISOString().slice(0, 10);
const contactBrevo = (email, attributs, extra = {}) => ({ email, emailBlacklisted: false, createdAt: ilYa(200), attributes: { SEGMENT: 'TRAIL_ENDURANCE', SCORE: 50, PRENOM: 'X', ...attributs }, ...extra });

test('réactivation : choisit les inactifs, exclut les récents, déjà relancés, désinscrits et repli', () => {
  const contacts = [
    contactBrevo('inactif@x.fr', { DERNIERE_ACTIVITE: ilYa(90), SCORE: 40 }),
    contactBrevo('chaud@x.fr', { DERNIERE_ACTIVITE: ilYa(75), SCORE: 90 }),
    contactBrevo('recent@x.fr', { DERNIERE_ACTIVITE: ilYa(10) }),
    contactBrevo('attente@x.fr', { DERNIERE_ACTIVITE: ilYa(90), RELANCE_STATUT: 'proposee' }),
    contactBrevo('relance@x.fr', { DERNIERE_ACTIVITE: ilYa(90), RELANCE_STATUT: 'envoyee', RELANCE_LE: ilYa(20) }),
    contactBrevo('stop@x.fr', { DERNIERE_ACTIVITE: ilYa(90) }, { emailBlacklisted: true }),
    contactBrevo('repli@x.fr', { DERNIERE_ACTIVITE: ilYa(90), SEGMENT: 'A_QUALIFIER' }),
    { email: 'audit@x.fr', attributes: {} },
  ];
  const r = executer('10_relance_selection.js', {}, CONF, [{ contacts }]);
  assert.deepEqual(r.map((i) => i.json.contact.email), ['chaud@x.fr', 'inactif@x.fr']);
  assert.equal(r[1].json.contact.joursInactif, 90);
});

test('réactivation : plafond de relances par passage', () => {
  const contacts = Array.from({ length: 12 }, (_, i) => contactBrevo(`c${i}@x.fr`, { DERNIERE_ACTIVITE: ilYa(100), SCORE: i }));
  const r = executer('10_relance_selection.js', {}, CONF, [{ contacts }]);
  assert.equal(r.length, config.maxRelances);
  assert.equal(r[0].json.contact.score, 11);
});

const CONTACT = { email: 'julie@exemple.fr', prenom: 'Julie', segment: 'TRAIL_ENDURANCE', niveau: 'confirme', score: 88, pratique: 'trail', frequence: '3-4', objectif: 'ultra', budget: '400-plus', joursInactif: 74 };
const RELANCE_OK = { objet: 'Les sentiers d\'automne t\'attendent', message: 'Ça fait un moment !\n\nUne sortie longue ce week-end ?', angle: 'Profil ultra : on parle de sortie longue.' };

test("relance : l'IA ne reçoit ni le prénom ni l'email", () => {
  const { requete } = executer('11_relance_prompt.js', { contact: CONTACT }, CONF);
  const tout = JSON.stringify(requete);
  assert.ok(!tout.includes('Julie') && !tout.includes('julie@'));
  assert.ok(tout.includes('74'));
});

test('relance : proposition mise en attente avec un jeton, email de validation vers toi seulement', () => {
  const r = executer('12_relance_proposition.js', claude(RELANCE_OK), { ...CONF, 'Préparer la relance': { contact: CONTACT } });
  const a = r.majContact.attributes;
  assert.equal(a.RELANCE_STATUT, 'proposee');
  assert.match(a.RELANCE_JETON, /^[0-9a-f]{36}$/);
  assert.equal(a.RELANCE_OBJET, RELANCE_OK.objet);
  assert.equal(r.emailValidation.to[0].email, config.emailAlerte);
  assert.ok(r.emailValidation.htmlContent.includes(`jeton=${a.RELANCE_JETON}&amp;action=envoyer`));
  assert.ok(r.emailValidation.htmlContent.includes('Une sortie longue ce week-end ?'));
  assert.equal(r.proposition.source, 'ia');
});

test('relance : deux propositions n\'ont jamais le même jeton', () => {
  const j = () => executer('12_relance_proposition.js', claude(RELANCE_OK), { ...CONF, 'Préparer la relance': { contact: CONTACT } }).majContact.attributes.RELANCE_JETON;
  assert.notEqual(j(), j());
});

test('relance : modèle du segment si l\'IA glisse une promotion', () => {
  const r = executer('12_relance_proposition.js', claude({ ...RELANCE_OK, message: 'Reviens, -15 % sur tout !' }), { ...CONF, 'Préparer la relance': { contact: CONTACT } });
  assert.equal(r.proposition.source, 'modele');
  assert.equal(r.majContact.attributes.RELANCE_OBJET, 'Et ton prochain ultra ?');
});

// Décision : GET (page de confirmation) puis POST (application).
const fiche = (attributs) => ({ statusCode: 200, body: { email: 'julie@exemple.fr', attributes: { PRENOM: 'Julie', SEGMENT: 'TRAIL_ENDURANCE', RELANCE_STATUT: 'proposee', RELANCE_JETON: 'abc123', RELANCE_OBJET: 'Objet test', RELANCE_MESSAGE: 'Premier.\n\nSecond.', ...attributs } } });
const decision = (requete, attributs = {}) => executer('13_relance_decision.js', fiche(attributs),
  { Configuration: { config, formulaire: requete.post || {}, query: requete.get || {} } });

test("décision : ouvrir le lien affiche une confirmation et n'envoie rien", () => {
  const r = decision({ get: { email: 'julie@exemple.fr', jeton: 'abc123', action: 'envoyer' } });
  assert.equal(r.action, 'afficher');
  assert.equal(r.emailContact, undefined);
  assert.ok(r.page.includes('method="post"') && r.page.includes('Oui, envoyer') && r.page.includes('Second.'));
});

test('décision : confirmer envoie la relance à l\'inscrit et ferme le jeton', () => {
  const r = decision({ post: { email: 'julie@exemple.fr', jeton: 'abc123', action: 'envoyer', decision: '1' } });
  assert.equal(r.action, 'envoyer');
  assert.equal(r.emailContact.to[0].email, 'julie@exemple.fr');
  assert.equal(r.emailContact.subject, 'Objet test');
  assert.ok(r.emailContact.htmlContent.includes('Second.'));
  assert.deepEqual(r.emailContact.tags, ['pacewell-relance']);
  assert.equal(r.majContact.attributes.RELANCE_STATUT, 'envoyee');
  assert.equal(r.majContact.attributes.RELANCE_JETON, '');
});

test('décision : ignorer ferme la relance sans rien envoyer', () => {
  const r = decision({ post: { email: 'julie@exemple.fr', jeton: 'abc123', action: 'ignorer', decision: '1' } });
  assert.equal(r.action, 'ignorer');
  assert.equal(r.emailContact, undefined);
  assert.equal(r.majContact.attributes.RELANCE_STATUT, 'ignoree');
});

test('décision : mauvais jeton, lien déjà utilisé ou incomplet → rien ne se passe', () => {
  assert.equal(decision({ post: { email: 'julie@exemple.fr', jeton: 'faux', action: 'envoyer', decision: '1' } }).action, 'erreur');
  const deja = decision({ post: { email: 'julie@exemple.fr', jeton: 'abc123', action: 'envoyer', decision: '1' } }, { RELANCE_JETON: '', RELANCE_STATUT: 'envoyee' });
  assert.equal(deja.action, 'erreur');
  assert.ok(deja.page.includes('déjà été envoyée'));
  assert.equal(decision({ get: { email: 'julie@exemple.fr' } }).action, 'erreur');
  assert.equal(decision({ get: { email: 'julie@exemple.fr', jeton: 'abc123', action: 'supprimer' } }).action, 'erreur');
});

test('décision : la page échappe le contenu stocké', () => {
  const r = decision({ get: { email: 'julie@exemple.fr', jeton: 'abc123', action: 'envoyer' } }, { RELANCE_OBJET: '<script>x</script>' });
  assert.ok(!r.page.includes('<script>x'));
});

// --- Étape 4 : statistiques et évaluation ----------------------------------------------------

test('statistiques : agrégats corrects et aucune donnée personnelle', () => {
  const contacts = [
    contactBrevo('a@x.fr', { SEGMENT: 'TRAIL_ENDURANCE', SCORE: 88, COUT_IA_USD: 0.0001, SOURCE_QUALIF: 'ia', QUALIFIE_LE: '2026-10-15', RAISON_IA: 'Ultra.', PRENOM: 'Alice' }),
    contactBrevo('b@x.fr', { SEGMENT: 'ROUTE_DEBUTANT', SCORE: 20, COUT_IA_USD: 0.0001, SOURCE_QUALIF: 'ia', QUALIFIE_LE: '2026-10-14', RELANCE_STATUT: 'envoyee' }),
    contactBrevo('c@x.fr', { SEGMENT: 'A_QUALIFIER', SCORE: 0, SOURCE_QUALIF: 'repli', QUALIFIE_LE: '2026-10-13' }),
    { email: 'client-audit@x.fr', attributes: { NOM: 'Audit' } },
  ];
  const etiquettes = [{ cle: 'bienvenue', tag: 'pacewell-bienvenue', libelle: 'Bienvenue' }, { cle: 'alerte', tag: 'pacewell-alerte', libelle: 'Alertes' }];
  const envois = [{ requests: 3, delivered: 3, uniqueOpens: 2, uniqueClicks: 1 }, { requests: 1, delivered: 1 }];
  const [{ json: s }] = executer('14_statistiques.js', {}, { ...CONF, 'Brevo : lister les contacts': { contacts }, 'Étiquettes à mesurer': etiquettes }, envois);
  assert.equal(s.inscrits, 3);
  assert.equal(s.segments.TRAIL_ENDURANCE.nombre, 1);
  assert.equal(s.leadsChauds, 1);
  assert.equal(s.scoreMoyen, 54);
  assert.equal(s.ia.replis, 1);
  assert.equal(s.ia.coutTotalUsd, 0.0002);
  assert.equal(s.relances.envoyees, 1);
  assert.deepEqual(s.emails.bienvenue, { libelle: 'Bienvenue', envoyes: 3, delivres: 3, ouvertures: 2, clics: 1, rejets: 0 });
  assert.equal(s.journal[0].raison, 'Ultra.');
  assert.equal(s.tranchesScore[8].nombre, 1);
  const tout = JSON.stringify(s);
  assert.ok(!tout.includes('@') && !tout.includes('Alice'));
});

test('évaluation : 30 profils annotés, segments attendus cohérents avec les règles du prompt', () => {
  const profils = JSON.parse(readFileSync(new URL('../evaluation/profils.json', import.meta.url), 'utf8'));
  assert.equal(profils.length, 30);
  for (const p of profils) {
    if (p.pratique === 'route') assert.ok(p.attendu.segment.startsWith('ROUTE'), p.id);
    if (p.pratique === 'trail') assert.ok(p.attendu.segment.startsWith('TRAIL'), p.id);
    assert.ok(p.attendu.temperatures.length >= 1);
  }
});

test('évaluation : le bilan compte segments et températures', () => {
  const profils = [
    { id: 1, pratique: 'trail', frequence: '3-4', objectif: 'ultra', budget: '400-plus', note: 'a', attendu: { segment: 'TRAIL_ENDURANCE', temperatures: ['chaud'] } },
    { id: 2, pratique: 'route', frequence: '1-2', objectif: '10km', budget: 'moins-150', note: 'b', attendu: { segment: 'ROUTE_DEBUTANT', temperatures: ['froid'] } },
  ];
  const resultats = [
    { qualification: { segment: 'TRAIL_ENDURANCE', score: 88, source: 'ia', raison: 'r', cout_usd: 0.0001 } },
    { qualification: { segment: 'ROUTE_PERF', score: 45, source: 'ia', raison: 'r', cout_usd: 0.0001 } },
  ];
  const [{ json: b }] = executer('16_evaluation_bilan.js', {}, { ...CONF, 'Profils annotés': profils.map((profil) => ({ profil })) }, resultats);
  assert.equal(b.segmentsCorrects, 1);
  assert.equal(b.temperaturesCorrectes, 1);
  assert.equal(b.coutTotalUsd, 0.0002);
});
