# Product Requirements Document - Checklist Ménage MVP

## 📋 Vue d'ensemble

**Projet** : Checklist Ménage  
**Version** : MVP v1.0  
**Date cible** : Jeudi 5 décembre 2025  
**Statut** : Draft → Validation → Développement  

---

## 🎯 Objectif

Remplacer le système actuel (PDF statique + photos WhatsApp) par une application web permettant de créer, assigner et valider des checklists de ménage personnalisées pour chaque logement géré par Letahost/Invest Malin.

**Problème actuel** :
- PDF identique pour tous les logements (pas de personnalisation)
- Photos envoyées via WhatsApp (pas de traçabilité, difficile à QA)
- Pas de workflow structuré entre Admin → Concierge → Prestataire
- Impossible de savoir si une tâche est complétée ou non en temps réel

**Solution proposée** :
- App web dédiée avec checklist personnalisée par logement
- Upload photos directement dans l'app, sync Drive en temps réel
- Workflow d'assignation clair avec rôles distincts
- Validation module par module avec preuve photo obligatoire

---

## 👥 Utilisateurs et Rôles

### Admin (Équipe interne)
- **Accès** : Toutes les checklists de tous les logements
- **Permissions** : 
  - Voir toutes les checklists créées
  - Assigner une checklist à un concierge
  - Modifier le template de base
  - Ajouter/supprimer des modules sur n'importe quelle checklist
  - Consulter l'historique complet

### Concierge
- **Accès** : Uniquement les checklists de ses logements assignés
- **Permissions** :
  - Voir ses checklists assignées
  - Assigner une checklist à un prestataire
  - Modifier les modules sur ses checklists (ajout/suppression)
  - Valider le travail du prestataire (QA)
  - Consulter les photos uploadées

### Prestataire
- **Accès** : Uniquement les checklists qui lui sont assignées
- **Permissions** :
  - Voir ses checklists assignées
  - Cocher les modules complétés
  - Uploader des photos par module (obligatoire)
  - Marquer la checklist comme "Terminée"
  - **PAS** de modification de la structure (pas d'ajout/suppression de modules)

---

## 🏗 Architecture Technique

### Stack
- **Frontend** : React + Vite + Tailwind CSS (même stack que Fiche logement)
- **Backend** : Supabase (partagé avec Fiche logement)
- **Auth** : Supabase Auth (roles via JWT claims ou table user_roles)
- **Storage** : Supabase Storage (nouveau bucket `checklist-photos`)
- **Sync Drive** : Make.com webhook (comme pour Fiche logement)
- **Déploiement** : Vercel (checklist-menage.vercel.app)

### Base de données Supabase

#### Table: `checklist_templates`
Template de base réutilisable pour tous les logements.

```sql
CREATE TABLE checklist_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL, -- "Template Standard Ménage"
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Table: `checklist_template_sections`
Sections du template (Entrée, Salon, Cuisine, etc.)

```sql
CREATE TABLE checklist_template_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID REFERENCES checklist_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- "Entrée", "Salon", "Cuisine"
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Table: `checklist_template_items`
Items (modules) du template par section.

```sql
CREATE TABLE checklist_template_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID REFERENCES checklist_template_sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL, -- "Vue d'ensemble de l'entrée (murs et sols)"
  instructions TEXT, -- Instructions détaillées pour le prestataire
  requires_photo BOOLEAN DEFAULT true, -- Photo obligatoire ou non
  order_index INTEGER NOT NULL,
  conditional_field TEXT, -- Référence au champ Fiche logement (ex: "equipements_jacuzzi")
  conditional_value TEXT, -- Valeur attendue pour afficher cet item (ex: "true")
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Table: `checklists`
Instance de checklist créée pour un logement spécifique.

```sql
CREATE TABLE checklists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fiche_id UUID NOT NULL, -- Référence à la table fiches
  numero_bien TEXT NOT NULL, -- Numéro du logement (ex: "12345")
  template_id UUID REFERENCES checklist_templates(id),
  status TEXT DEFAULT 'draft', -- 'draft', 'assigned_concierge', 'assigned_prestataire', 'in_progress', 'completed', 'validated'
  assigned_concierge_id UUID REFERENCES auth.users(id),
  assigned_prestataire_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  assigned_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  validated_at TIMESTAMP WITH TIME ZONE
);
```

#### Table: `checklist_sections`
Sections de la checklist instance (copiées depuis template + custom).

```sql
CREATE TABLE checklist_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id UUID REFERENCES checklists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  is_custom BOOLEAN DEFAULT false, -- true si ajoutée manuellement après création
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Table: `checklist_items`
Items de la checklist instance (copiés depuis template + custom).

```sql
CREATE TABLE checklist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID REFERENCES checklist_sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  instructions TEXT,
  requires_photo BOOLEAN DEFAULT true,
  order_index INTEGER NOT NULL,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by UUID REFERENCES auth.users(id),
  is_custom BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Table: `checklist_photos`
Photos uploadées par item.

```sql
CREATE TABLE checklist_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID REFERENCES checklist_items(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  synced_to_drive BOOLEAN DEFAULT false,
  drive_file_id TEXT
);
```

#### Table: `user_roles`
Gestion des rôles utilisateurs.

```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'admin', 'concierge', 'prestataire'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, role)
);
```

---

## 🔄 Workflows

### Workflow 1 : Création automatique de checklist
**Déclencheur** : Clic sur "Finaliser" dans FicheFinalisation.jsx

1. Récupération des données de la fiche (fiche_id, numero_bien, équipements)
2. Appel fonction `createChecklistFromFiche(ficheId)`
3. Lecture du template actif
4. Filtrage des items conditionnels selon équipements du logement
   - Ex: Si `equipements_jacuzzi = true` → ajouter item "Jacuzzi"
   - Ex: Si `chambres_canape_lit > 0` ET `chambres_draps_fournis = true` → ajouter "Linge canapé-lit"
5. Création de l'instance checklist en base avec status = 'draft'
6. (Optionnel) Notification webhook Make → email admin "Nouvelle checklist créée"

### Workflow 2 : Assignation Admin → Concierge
**Interface** : Dashboard Admin

1. Admin voit la liste des checklists en status 'draft'
2. Admin clique sur "Assigner à un concierge"
3. Sélection du concierge dans une dropdown
4. Update status → 'assigned_concierge' + `assigned_concierge_id` + `assigned_at`
5. Notification email au concierge (via Make webhook)

### Workflow 3 : Assignation Concierge → Prestataire
**Interface** : Dashboard Concierge

1. Concierge voit ses checklists assignées (status = 'assigned_concierge')
2. Concierge clique sur "Assigner à un prestataire"
3. Sélection du prestataire dans une dropdown
4. Update status → 'assigned_prestataire' + `assigned_prestataire_id`
5. Notification email au prestataire (via Make webhook)

### Workflow 4 : Validation par Prestataire
**Interface** : Vue Checklist Prestataire (mobile-first)

1. Prestataire ouvre la checklist assignée (status = 'assigned_prestataire')
2. Status auto-update → 'in_progress' + `started_at` au premier clic
3. Pour chaque item :
   - Prestataire lit le titre et les instructions
   - Prestataire upload photo(s) (1 minimum si `requires_photo = true`)
   - Prestataire coche le module comme complété
   - Auto-save : `is_completed = true` + `completed_at` + `completed_by`
4. Photos uploadées → Supabase Storage + trigger webhook Make
5. Make récupère la photo → upload vers Drive en temps réel
6. Quand tous les items complétés → bouton "Marquer comme Terminée"
7. Update status → 'completed' + `completed_at`
8. Notification au concierge (via Make webhook)

### Workflow 5 : Validation QA par Concierge
**Interface** : Dashboard Concierge

1. Concierge voit checklist en status 'completed'
2. Concierge consulte les photos uploadées par item
3. Concierge valide ou refuse
   - Si refusé → status → 'assigned_prestataire' (retour au prestataire)
   - Si validé → status → 'validated' + `validated_at`
4. Notification au prestataire et admin

---

## 📱 Interfaces Utilisateur

### Dashboard Admin
**URL** : `/admin/dashboard`

**Composants** :
- Liste de toutes les checklists avec filtres (status, logement, date)
- Tableau avec colonnes : Logement | Concierge | Prestataire | Status | Date création | Actions
- Actions : Voir détails | Assigner concierge | Modifier template | Supprimer

### Dashboard Concierge
**URL** : `/concierge/dashboard`

**Composants** :
- Liste des checklists assignées au concierge (filtre status)
- Tableau avec colonnes : Logement | Prestataire | Status | Date assignation | Actions
- Actions : Voir détails | Assigner prestataire | Ajouter modules custom | Valider QA

### Vue Checklist Prestataire
**URL** : `/prestataire/checklist/:id`

**Composants** (mobile-first) :
- Header : Numéro logement + statut progression (ex: 12/45 items complétés)
- Accordion par section (Entrée, Salon, Cuisine...)
- Par item :
  - Titre en gras
  - Instructions en texte normal
  - Zone upload photo (drag & drop ou clic)
  - Aperçu photos uploadées (miniatures)
  - Checkbox "Terminé" (disabled tant que photo pas uploadée si required)
- Footer sticky : Bouton "Marquer comme Terminée" (disabled si tous items pas complétés)

### Vue Détail Checklist (Admin/Concierge)
**URL** : `/checklist/:id`

**Composants** :
- Header : Infos logement (numéro, adresse si dispo)
- Timeline status (draft → assigned → in progress → completed → validated)
- Tabs :
  - Tab "Checklist" : Vue complète avec toutes les sections/items + photos
  - Tab "Historique" : Log des actions (qui a fait quoi et quand)
  - Tab "Modifier" : Ajouter/supprimer sections/items custom (admin/concierge only)

---

## 🎨 Design System

On réutilise le design system de Fiche logement pour cohérence :
- **Couleurs** : Mêmes couleurs primaires (bleu Letahost)
- **Typographie** : Inter ou Poppins
- **Composants** : Buttons, Inputs, Cards réutilisables
- **Icons** : Lucide React (comme Fiche logement)

**Spécificités Checklist Ménage** :
- **Mobile-first** pour vue prestataire (80% des utilisations sur mobile)
- **Checkmarks visuels** : Animation au clic pour feedback immédiat
- **Progress bar** : Visuelle en haut pour montrer avancement global

---

## 🔗 Intégration avec Fiche Logement

### Déclenchement automatique
**Fichier modifié** : `FicheFinalisation.jsx`

**Ajout dans handleFinalize()** :
```javascript
// Après mise à jour status = "Complété"
const { data: checklist, error } = await createChecklistFromFiche(ficheId);
if (error) {
  console.error('Erreur création checklist:', error);
  // Toast notification erreur
} else {
  console.log('Checklist créée:', checklist.id);
  // Toast notification succès
}
```

### Fonction createChecklistFromFiche()
**Fichier** : `src/utils/checklistHelpers.js`

**Logique** :
1. Récupérer la fiche complète depuis Supabase
2. Récupérer le template actif
3. Parser les champs conditionnels de la fiche
4. Filtrer les items du template selon conditions
5. Créer l'instance checklist + sections + items en base
6. Retourner l'ID de la checklist créée

**Mapping des champs conditionnels** (exemples) :
```javascript
const CONDITIONAL_MAPPINGS = {
  'equipements_jacuzzi': 'equipementspecifiques_jacuzzi',
  'equipements_piscine': 'equipementspecifiques_piscine',
  'equipements_sauna': 'equipementspecifiques_sauna',
  'equipements_barbecue': 'equipementspecifiques_barbecue_plancha',
  'chambres_canape_lit': 'salonsam_canape_lit',
  'chambres_draps_fournis': 'chambres_draps',
  'salledebains_seche_serviettes': 'salledebains_seche_serviettes',
  'salledebains_lave_linge': 'salledebains_lave_linge',
  // ... autres mappings selon doc Word
};
```

---

## 📸 Gestion des Photos

### Upload
- **Composant** : `PhotoUploadChecklist.jsx` (réutiliser pattern de `PhotoUpload.jsx`)
- **Bucket Supabase** : `checklist-photos`
- **Structure** : `checklist-{id}/item-{item_id}/photo-{timestamp}.jpg`
- **Compression** : Client-side pour photos < 5MB, sinon backend Railway (réutiliser service existant)

### Sync Drive
- **Trigger** : Insertion dans `checklist_photos`
- **SQL Trigger** : `notify_checklist_photo_upload()`
- **Webhook Make** : `https://hook.eu2.make.com/[NEW_WEBHOOK_ID]`
- **Payload** :
```json
{
  "checklist_id": "uuid",
  "item_id": "uuid",
  "item_title": "Vue d'ensemble cuisine",
  "photo_url": "https://...",
  "numero_bien": "12345",
  "uploaded_by": "email_prestataire",
  "uploaded_at": "2025-12-05T10:30:00Z"
}
```

- **Action Make** :
  1. Download photo depuis Supabase Storage
  2. Upload vers Drive dans dossier : `Checklist Ménage/{numero_bien}/{date}/`
  3. Update `checklist_photos.synced_to_drive = true` + `drive_file_id`

---

## 🚀 Plan de Développement MVP

### Phase 1 : Setup projet (2h)
- [ ] Créer repo GitHub `checklist-menage`
- [ ] Init React + Vite + Tailwind
- [ ] Setup Supabase client
- [ ] Créer toutes les tables SQL
- [ ] Setup auth avec Supabase
- [ ] Déployer sur Vercel (checklist-menage.vercel.app)

### Phase 2 : Template & Création Checklist (4h)
- [ ] Seeder SQL pour template de base (à partir du doc Word)
- [ ] Fonction `createChecklistFromFiche()` avec logique conditionnelle
- [ ] Intégration dans `FicheFinalisation.jsx`
- [ ] Tests création checklist depuis fiche existante

### Phase 3 : Dashboard Admin (3h)
- [ ] Layout admin avec liste checklists
- [ ] Filtres par status/logement
- [ ] Action "Assigner à concierge" avec dropdown
- [ ] Vue détail checklist (lecture seule pour MVP)

### Phase 4 : Vue Prestataire (5h)
- [ ] Layout mobile-first avec sections accordion
- [ ] Composant item avec upload photo
- [ ] Logique checkbox disabled si photo manquante
- [ ] Progress bar dynamique
- [ ] Bouton "Marquer comme Terminée"
- [ ] Auto-save en temps réel (debounced)

### Phase 5 : Photos & Sync Drive (3h)
- [ ] Composant `PhotoUploadChecklist.jsx`
- [ ] Upload vers Supabase Storage
- [ ] SQL trigger `notify_checklist_photo_upload()`
- [ ] Webhook Make pour sync Drive
- [ ] Tests upload + sync

### Phase 6 : Dashboard Concierge (2h)
- [ ] Layout concierge avec liste checklists assignées
- [ ] Action "Assigner à prestataire" avec dropdown
- [ ] Vue détail avec photos uploadées (QA)
- [ ] Action "Valider" ou "Refuser"

### Phase 7 : Roles & Permissions (2h)
- [ ] Middleware auth avec vérification role
- [ ] RLS Supabase pour isolation des données par role
- [ ] Tests permissions (admin voit tout, concierge ses checklists, prestataire ses assignations)

### Phase 8 : Polish & Tests (3h)
- [ ] Toast notifications pour toutes les actions
- [ ] Loading states
- [ ] Error handling
- [ ] Tests end-to-end du workflow complet
- [ ] Documentation README

**Total estimé : ~24h de dev**  
**Timeline réaliste** : 2 jours intensifs (mardi + mercredi) = jeudi présentation

---

## ✅ Critères de Succès MVP

### Must-Have (obligatoire pour jeudi)
- ✅ Checklist auto-créée à la finalisation d'une fiche
- ✅ Template de base fonctionnel avec toutes les sections du doc Word
- ✅ Items conditionnels affichés selon équipements du logement
- ✅ Vue prestataire mobile avec upload photos + checkboxes
- ✅ Photos uploadées vers Supabase Storage
- ✅ Dashboard admin pour assigner aux concierges
- ✅ Dashboard concierge pour assigner aux prestataires
- ✅ Roles fonctionnels (admin/concierge/prestataire)

### Nice-to-Have (si temps)
- ⚠️ Sync photos vers Drive via Make
- ⚠️ Validation QA par concierge
- ⚠️ Ajout modules custom par admin/concierge
- ⚠️ Historique des actions
- ⚠️ Notifications email via webhooks

### Hors-Scope MVP
- ❌ Modification du template de base depuis l'UI
- ❌ Statistiques/rapports
- ❌ Export PDF de la checklist
- ❌ Commentaires/annotations sur photos
- ❌ Multi-langue

---

## 🔒 Sécurité & RLS (Row Level Security)

### Policies Supabase

**checklists** :
```sql
-- Admin : voit tout
CREATE POLICY admin_all_checklists ON checklists
  FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- Concierge : voit uniquement ses checklists assignées
CREATE POLICY concierge_assigned_checklists ON checklists
  FOR SELECT USING (assigned_concierge_id = auth.uid());

-- Prestataire : voit uniquement ses checklists assignées
CREATE POLICY prestataire_assigned_checklists ON checklists
  FOR SELECT USING (assigned_prestataire_id = auth.uid());
```

**checklist_items** :
```sql
-- Prestataire : peut update is_completed et completed_at sur ses checklists
CREATE POLICY prestataire_update_items ON checklist_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM checklists c
      INNER JOIN checklist_sections cs ON cs.checklist_id = c.id
      WHERE cs.id = checklist_items.section_id
      AND c.assigned_prestataire_id = auth.uid()
    )
  );
```

**checklist_photos** :
```sql
-- Prestataire : peut insert photos sur ses checklists
CREATE POLICY prestataire_insert_photos ON checklist_photos
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM checklists c
      INNER JOIN checklist_sections cs ON cs.checklist_id = c.id
      INNER JOIN checklist_items ci ON ci.section_id = cs.id
      WHERE ci.id = checklist_photos.item_id
      AND c.assigned_prestataire_id = auth.uid()
    )
  );
```

---

## 📝 Notes & Décisions Techniques

### Pourquoi ne pas intégrer directement dans Fiche logement ?
- Code plus propre et maintenable
- Déploiement indépendant = moins de risques
- Interface mobile-first différente de Fiche logement
- Évolution autonome sans impacter la prod

### Pourquoi même Supabase ?
- Accès direct aux données fiches sans duplication
- Auth centralisée
- Moins d'infra à gérer
- Triggers SQL pour synchronisation facile

### Pourquoi Make.com et pas API Google Drive ?
- API Google Drive = complexité élevée (OAuth, gestion tokens, quotas)
- Make.com = workflow déjà rodé sur Fiche logement
- Temps de dev réduit (MVP jeudi)
- Fiabilité éprouvée

### Gestion des items conditionnels
- **Approche choisie** : Filtrage à la création de la checklist
- **Alternative rejetée** : Affichage/masquage dynamique côté frontend (trop complexe, items fantômes)
- **Conséquence** : Si équipements changent dans la fiche après création checklist, la checklist n'est PAS mise à jour automatiquement (OK pour MVP)

---

## 🐛 Risques Identifiés

### Risque 1 : Mapping champs conditionnels imprécis
**Impact** : Items manquants ou en trop dans la checklist  
**Mitigation** : Tests exhaustifs avec plusieurs fiches réelles

### Risque 2 : Upload photos lent sur mobile 3G/4G
**Impact** : Frustration prestataire, timeout  
**Mitigation** : Compression client-side, indicateurs de progression clairs

### Risque 3 : RLS mal configuré → fuites de données
**Impact** : Prestataire voit checklists d'autres prestataires  
**Mitigation** : Tests approfondis avec différents comptes/roles

### Risque 4 : Deadline jeudi trop courte
**Impact** : MVP incomplet, bugs non résolus  
**Mitigation** : Priorisation stricte Must-Have vs Nice-to-Have, focus sur workflow principal

---

## 📚 Références

- **Doc Word Checklist** : `Checklist_ménage.docx`
- **Repo Fiche logement** : https://github.com/INVESTMALIN/fiche-logement_ia-githubcopilot-v1
- **Supabase Fiche logement** : Projet partagé
- **Make.com workflows** : Compte Letahost

---

**Document validé par** : [À compléter après relecture]  
**Date de validation** : [À compléter]  
**Prochaine étape** : Création repo GitHub + setup initial