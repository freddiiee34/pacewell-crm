# Pacewell CRM : agent de qualification et de rétention

> Chaque nouvel inscrit est qualifié par l'IA, segmenté, reçoit un parcours personnalisé dans Brevo, et les clients qui décrochent sont relancés automatiquement, avec validation humaine.

Pacewell est une **marque fictive** (boutique en ligne de running et de trail) créée pour démontrer une chaîne CRM complète : capture, qualification par IA, segmentation, personnalisation, réactivation et mesure.

## Avancement

| Étape | Contenu | État |
| --- | --- | --- |
| 1. Socle | Landing d'inscription, workflow n8n « Qualification », mise en place Brevo | ✅ Livré et testé |
| 2. Personnalisation | Template HTML de la marque, objet et bloc de contenu rédigés par l'IA | À venir |
| 3. Réactivation | Clients inactifs depuis plus de 60 jours, message proposé par l'IA, validation en un clic | À venir |
| 4. Mesure | Journal des décisions, coût par lead, tableau de bord, évaluation sur 30 leads | À venir |

## Étape 1 : le workflow « Qualification »

```
Landing ──POST──▶ Webhook n8n
                    │
                    ├─ Nettoyer et valider ──(invalide)──▶ 400
                    ├─ Brevo : contact existant ?
                    ├─ Dédoublonner ──(déjà qualifié, mêmes réponses < 7 j)──▶ 200, sans appel IA
                    ├─ Préparer le prompt (sans email ni prénom)
                    ├─ Claude Haiku 5.5 : segment, niveau, score 1-100, raison (JSON strict)
                    ├─ Valider la réponse IA ──(échec)──▶ segment A_QUALIFIER
                    ├─ Brevo : créer ou mettre à jour le contact + bonne liste
                    ├─ Score ≥ 70 ? ──▶ alerte email « lead chaud »
                    └─ 200 {ok: true}
```

**Segments** : `ROUTE_DEBUTANT`, `ROUTE_PERF`, `TRAIL_DECOUVERTE`, `TRAIL_ENDURANCE`, plus `A_QUALIFIER` (repli).

### Garde-fous

- **Sortie de l'IA vérifiée** : segment et niveau dans une liste fermée, score entier entre 1 et 100, raison non vide, et cohérence avec les réponses (un coureur « route » ne peut pas être classé en trail). Au moindre écart, ou si l'API est en panne, le contact part dans `A_QUALIFIER` avec le motif du repli : il n'est jamais perdu.
- **Minimisation des données (RGPD)** : l'IA ne reçoit ni l'email ni le prénom, seulement les réponses au questionnaire.
- **Consentement obligatoire**, champ piège anti-robots, CORS limité au domaine de la landing.
- **Dédoublonnage** : même contact, mêmes réponses, qualifié il y a moins de 7 jours → pas de nouvel appel IA.
- **Coût suivi par lead** : calculé à partir des tokens réellement consommés et enregistré dans Brevo (`COUT_IA_USD`). Avec Claude Haiku 5.5 (0,10 $ / 0,50 $ par million de tokens en entrée / sortie), un lead coûte environ 0,0001 $.
- **Un seul contact par email** : création ou mise à jour (upsert), ajouté à la liste de son segment et retiré des autres.

### Tests

```bash
node --test tests/*.test.mjs          # 22 tests : code des nœuds n8n
python3 -m pytest -q tests/           # 3 tests : script Brevo
python3 tests/n8n/e2e.py <chemin vers n8n>   # 17 vérifications dans un vrai n8n
```

Le test de bout en bout lance un vrai n8n (2.35), importe le workflow et le fait tourner contre un faux Brevo et un faux Claude : lead chaud, lead tiède, IA qui répond n'importe quoi, API en panne, doublon, formulaire invalide, robot.

## Mise en route

### 1. Installer n8n sur le VPS (Coolify)

1. Dans Coolify : **Projects › Portfolio › + New › Service**, chercher **n8n**, choisir la version avec PostgreSQL si elle est proposée.
2. Domaine : `https://n8n.simondelrue.fr`. Vérifier que la variable `WEBHOOK_URL` vaut `https://n8n.simondelrue.fr/`.
3. **Deploy**, puis ouvrir `https://n8n.simondelrue.fr` et créer le compte propriétaire **tout de suite** (le premier inscrit devient administrateur).

### 2. Préparer Brevo

```
set BREVO_API_KEY=cle-brevo        (Windows)
python scripts\setup_brevo.py --simulation
python scripts\setup_brevo.py
```

Le script crée les attributs et les 5 listes, puis affiche leurs ID.

### 3. Les identifiants dans n8n

**Credentials › New › Header Auth**, deux fois :

| Nom | Name (en-tête) | Value |
| --- | --- | --- |
| `Brevo API` | `api-key` | clé API Brevo |
| `Claude API` | `x-api-key` | clé API Anthropic (console.anthropic.com) |

### 4. Importer et configurer le workflow

1. **Workflows › Import from File**, puis `n8n/pacewell-qualification.json`.
2. Ouvrir les 4 nœuds HTTP (Brevo ×3, Claude ×1) et sélectionner le bon identifiant s'il est signalé.
3. Ouvrir le nœud **Configuration** et coller les ID de listes affichés par le script.
4. **Publish** (bouton en haut à droite) pour activer le webhook de production.

### 5. Mettre la landing en ligne

Dans Coolify, nouvelle application depuis ce dépôt, **Base Directory** : `/landing`, **Build Pack** : Dockerfile, port **80**, domaine `https://pacewell.simondelrue.fr`.

## Structure

```
landing/                 page d'inscription (HTML/CSS/JS sans dépendance) + Dockerfile nginx
n8n/code/                code des nœuds n8n, un fichier par nœud (testé)
n8n/construire_workflow.py   assemble le JSON importable à partir de n8n/code/
n8n/pacewell-qualification.json   le workflow à importer
scripts/setup_brevo.py   attributs et listes Brevo
tests/                   tests unitaires, test du script Brevo, test de bout en bout n8n
```

Pour modifier un nœud : éditer son fichier dans `n8n/code/`, relancer `python3 n8n/construire_workflow.py` et les tests, puis réimporter le JSON.
