# Pacewell CRM : agent de qualification et de rétention

> Chaque nouvel inscrit est qualifié par l'IA, segmenté, reçoit un parcours personnalisé dans Brevo, et les clients qui décrochent sont relancés automatiquement, avec validation humaine.

Pacewell est une **marque fictive** (boutique en ligne de running et de trail) créée pour démontrer une chaîne CRM complète : capture, qualification par IA, segmentation, personnalisation, réactivation et mesure.

## Avancement

| Étape | Contenu | État |
| --- | --- | --- |
| 1. Socle | Landing d'inscription, workflow n8n « Qualification », mise en place Brevo | Livré et testé |
| 2. Personnalisation | Email de bienvenue aux couleurs de la marque, objet et conseils rédigés par l'IA | Livré et testé |
| 3. Réactivation | Inscrits inactifs depuis plus de 60 jours, relance proposée par l'IA, validation humaine | Livré et testé |
| 4. Mesure | Tableau de bord public, journal des décisions, coût par lead, évaluation sur 30 profils | Livré et testé |

Démo : [pacewell.simondelrue.fr](https://pacewell.simondelrue.fr) · tableau de bord : [pacewell.simondelrue.fr/tableau-de-bord](https://pacewell.simondelrue.fr/tableau-de-bord)

## Les cinq workflows n8n

| Workflow | Déclencheur | Rôle |
| --- | --- | --- |
| Qualification des inscrits | formulaire de la landing | qualifie, range dans Brevo, envoie la bienvenue et l'alerte |
| Réactivation des inactifs | chaque lundi à 9 h, ou à la main | propose des relances, demande une validation |
| Validation des relances | liens de l'email de validation | page de confirmation, puis envoi ou abandon |
| Statistiques | tableau de bord | renvoie les chiffres agrégés, sans donnée personnelle |
| Évaluation de l'IA | à la main | passe 30 profils annotés dans le prompt de production |

### Étapes 1 et 2 : qualification et bienvenue

```
Landing ──POST──▶ Webhook n8n
                    │
                    ├─ Nettoyer et valider ──(invalide)──▶ 400
                    ├─ Réponse 200 immédiate : le visiteur n'attend pas l'IA
                    ├─ Brevo : contact existant ?
                    ├─ Dédoublonner ──(déjà qualifié, mêmes réponses < 7 j)──▶ fin, sans appel IA
                    ├─ Claude Haiku 5.5 : segment, niveau, score 1-100, raison (JSON strict)
                    ├─ Valider la réponse IA ──(échec)──▶ segment A_QUALIFIER
                    ├─ Brevo : créer ou mettre à jour le contact + bonne liste
                    ├─ Nouvel inscrit ? ──▶ Claude rédige objet, intro, 3 conseils, conseil équipement
                    │                        ├─ texte vérifié ──(interdit ou illisible)──▶ modèle du segment
                    │                        └─ Brevo : email de bienvenue (HTML + texte)
                    └─ Score ≥ 70 ? ──▶ alerte « lead chaud » au commercial
```

**Segments** : `ROUTE_DEBUTANT`, `ROUTE_PERF`, `TRAIL_DECOUVERTE`, `TRAIL_ENDURANCE`, plus `A_QUALIFIER` (repli).

### Étape 3 : réactivation avec validation humaine

```
Chaque lundi ─▶ Brevo : liste des contacts
               ├─ Choisir les inactifs : plus de 60 jours, pas déjà relancés, pas désinscrits, 5 au plus
               ├─ Claude propose objet + message + l'angle choisi ──(interdit)──▶ modèle du segment
               ├─ Brevo : relance mise en attente avec un jeton à usage unique
               └─ Email de validation au commercial : « Envoyer » ou « Ignorer »

Clic ─▶ page de confirmation (le lien seul ne déclenche rien)
      └─ Confirmation ─▶ envoi à l'inscrit ou abandon, jeton effacé : un lien ne sert qu'une fois
```

### Étape 4 : mesure

- **Tableau de bord** (`landing/tableau-de-bord.html`) : inscrits, leads chauds, score moyen, coût de l'IA, répartition par segment et par score, emails envoyés, délivrés, ouverts et cliqués (statistiques Brevo), relances, et journal des 15 dernières décisions de l'IA avec leur raison. Les chiffres sont calculés par n8n : la page ne reçoit ni email ni prénom.
- **Évaluation** (`evaluation/profils.json`) : 30 profils annotés à la main (segment attendu, température acceptée). Le workflow « Évaluation de l'IA » les passe dans le prompt et les garde-fous de production ; le résultat est publié dans `landing/evaluation.json` et affiché sur le tableau de bord. Variante en local : `node scripts/evaluer.mjs` avec `ANTHROPIC_API_KEY`.

### Garde-fous

- **Sortie de l'IA vérifiée** : segment et niveau dans une liste fermée, score entier entre 1 et 100, cohérence avec les réponses. Au moindre écart, ou si l'API est en panne, le contact part dans `A_QUALIFIER` avec le motif du repli : il n'est jamais perdu.
- **Textes de l'IA filtrés avant envoi** : longueur maximale, pas de prix, de pourcentage, de promotion, de lien, d'adresse, d'emoji ni de promesse de santé. Sinon, un modèle écrit à la main pour le segment prend le relais.
- **Humain dans la boucle** : aucune relance ne part sans validation ; le lien ouvre une page de confirmation (les antivirus de messagerie qui visitent les liens ne déclenchent rien) et le jeton ne sert qu'une fois.
- **Minimisation des données (RGPD)** : l'IA ne reçoit jamais ni l'email ni le prénom ; le prénom est ajouté par le gabarit. Le tableau de bord n'affiche que des agrégats.
- **Consentement obligatoire**, champ piège anti-robots, CORS limité au domaine de la landing.
- **Coût suivi par lead** : calculé à partir des tokens réellement consommés et enregistré dans Brevo (`COUT_IA_USD`). Avec Claude Haiku 5.5, une qualification coûte environ 0,0001 $.

### Tests

```bash
node --test tests/*.test.mjs          # 48 tests : code des nœuds n8n
python3 -m pytest -q tests/           # 3 tests : script Brevo
python3 tests/n8n/e2e.py <chemin vers n8n>   # 10 scénarios dans un vrai n8n
```

Le test de bout en bout lance un vrai n8n (2.35), importe les cinq workflows et les fait tourner contre un faux Brevo et un faux Claude : lead chaud avec bienvenue et alerte, lead tiède, IA qui répond n'importe quoi, API en panne, doublon, formulaire invalide, robot, réactivation, validation (confirmation, envoi, lien rejoué, abandon), statistiques sans donnée personnelle, évaluation sur 30 profils.

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

### 4. Importer et configurer les workflows

1. **Workflows › Import from File**, puis chacun des fichiers `n8n/pacewell-*.json`.
2. Dans chaque workflow, ouvrir les nœuds HTTP et sélectionner le bon identifiant s'il est signalé.
3. Ouvrir chaque nœud **Configuration** et coller les ID de listes affichés par le script.
4. **Publish** les workflows Qualification, Réactivation, Validation et Statistiques. L'évaluation se lance à la main (**Execute workflow**).

### 5. Mettre la landing en ligne

Dans Coolify, nouvelle application depuis ce dépôt, **Base Directory** : `/landing`, **Build Pack** : Dockerfile, port **80**, domaine `https://pacewell.simondelrue.fr`.

## Structure

```
landing/                 landing, tableau de bord, résultat de l'évaluation, Dockerfile nginx
n8n/code/                code des nœuds n8n, un fichier par nœud (testé) ; _commun.js est recopié en tête des nœuds 08 et suivants
n8n/construire_workflow.py   assemble les JSON importables à partir de n8n/code/
n8n/pacewell-*.json      les cinq workflows à importer
evaluation/              30 profils annotés et derniers résultats
scripts/setup_brevo.py   attributs et listes Brevo
scripts/evaluer.mjs      évaluation en local, sans n8n
tests/                   tests unitaires, test du script Brevo, test de bout en bout n8n
```

Pour modifier un nœud : éditer son fichier dans `n8n/code/`, relancer `python3 n8n/construire_workflow.py` et les tests, puis réimporter les JSON.
