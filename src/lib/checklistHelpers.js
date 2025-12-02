import { supabase } from './supabaseClient'

/**
 * Mapping des champs conditionnels entre template items et champs Fiche logement
 * Format: 'conditional_field' (dans template) → 'fiche_field' (dans table fiches)
 */
const CONDITIONAL_MAPPINGS = {
    'salonsam_fauteuils': 'salonsam_fauteuils',
    'equipementspecifiques_jacuzzi': 'equipementspecifiques_jacuzzi',
    'equipementspecifiques_piscine': 'equipementspecifiques_piscine',
    'salledebains_seche_serviettes': 'salledebains_seche_serviettes',
    'salledebains_lave_linge': 'salledebains_lave_linge',
    // Ajouter d'autres mappings au besoin
}

/**
 * Crée une checklist à partir d'une fiche logement
 * @param {string} ficheId - UUID de la fiche
 * @returns {Object} { data: checklistId, error: null } ou { data: null, error: message }
 */
export async function createChecklistFromFiche(ficheId) {
    try {
        console.log('[createChecklistFromFiche] Start avec ficheId:', ficheId)

        // 1. Récupérer la fiche complète depuis Supabase
        const { data: fiche, error: ficheError } = await supabase
            .from('fiches')
            .select('*')
            .eq('id', ficheId)
            .single()

        if (ficheError) {
            console.error('[createChecklistFromFiche] Erreur récupération fiche:', ficheError)
            return { data: null, error: 'Fiche introuvable' }
        }

        if (!fiche) {
            return { data: null, error: 'Fiche introuvable' }
        }

        console.log('[createChecklistFromFiche] Fiche récupérée:', fiche.numero_bien)

        // 2. Récupérer le template actif
        const { data: template, error: templateError } = await supabase
            .from('checklist_templates')
            .select('*')
            .eq('is_active', true)
            .single()

        if (templateError || !template) {
            console.error('[createChecklistFromFiche] Erreur récupération template:', templateError)
            return { data: null, error: 'Template introuvable' }
        }

        console.log('[createChecklistFromFiche] Template récupéré:', template.name)

        // 3. Récupérer les sections du template
        const { data: templateSections, error: sectionsError } = await supabase
            .from('checklist_template_sections')
            .select('*')
            .eq('template_id', template.id)
            .order('order_index')

        if (sectionsError) {
            console.error('[createChecklistFromFiche] Erreur récupération sections:', sectionsError)
            return { data: null, error: 'Erreur récupération sections template' }
        }

        console.log('[createChecklistFromFiche] Sections récupérées:', templateSections.length)

        // 4. Récupérer les items du template
        const { data: templateItems, error: itemsError } = await supabase
            .from('checklist_template_items')
            .select('*')
            .in('section_id', templateSections.map(s => s.id))
            .order('order_index')

        if (itemsError) {
            console.error('[createChecklistFromFiche] Erreur récupération items:', itemsError)
            return { data: null, error: 'Erreur récupération items template' }
        }

        console.log('[createChecklistFromFiche] Items récupérés:', templateItems.length)

        // 5. Filtrer les items selon conditions (si conditional_field existe)
        const filteredItems = templateItems.filter(item => {
            // Si pas de condition, on garde l'item
            if (!item.conditional_field) {
                return true
            }

            // Récupérer le champ de la fiche correspondant
            const ficheField = CONDITIONAL_MAPPINGS[item.conditional_field] || item.conditional_field
            const ficheValue = fiche[ficheField]

            console.log('[Filter] Item:', item.title, '| Condition:', item.conditional_field, '=', item.conditional_value, '| Fiche value:', ficheValue)

            // Vérifier la condition
            if (item.conditional_value === 'true') {
                return ficheValue === true || ficheValue === 'true'
            }

            return ficheValue === item.conditional_value
        })

        console.log('[createChecklistFromFiche] Items après filtrage:', filteredItems.length)

        // 6. Créer la checklist instance
        const { data: newChecklist, error: checklistError } = await supabase
            .from('checklists')
            .insert({
                fiche_id: ficheId,
                numero_bien: fiche.numero_bien || 'N/A',
                template_id: template.id,
                status: 'draft'
            })
            .select()
            .single()

        if (checklistError) {
            console.error('[createChecklistFromFiche] Erreur création checklist:', checklistError)
            return { data: null, error: 'Erreur création checklist' }
        }

        console.log('[createChecklistFromFiche] Checklist créée:', newChecklist.id)

        // 7. Créer les sections de la checklist
        const sectionsToInsert = templateSections.map(section => ({
            checklist_id: newChecklist.id,
            name: section.name,
            order_index: section.order_index,
            is_custom: false
        }))

        const { data: newSections, error: newSectionsError } = await supabase
            .from('checklist_sections')
            .insert(sectionsToInsert)
            .select()

        if (newSectionsError) {
            console.error('[createChecklistFromFiche] Erreur création sections:', newSectionsError)
            // Rollback: supprimer la checklist créée
            await supabase.from('checklists').delete().eq('id', newChecklist.id)
            return { data: null, error: 'Erreur création sections' }
        }

        console.log('[createChecklistFromFiche] Sections créées:', newSections.length)

        // 8. Créer un mapping section_id template → section_id checklist
        const sectionMapping = {}
        templateSections.forEach((templateSection, index) => {
            sectionMapping[templateSection.id] = newSections[index].id
        })

        // 9. Créer les items de la checklist (uniquement les items filtrés)
        const itemsToInsert = filteredItems.map(item => ({
            section_id: sectionMapping[item.section_id],
            title: item.title,
            instructions: item.instructions,
            requires_photo: item.requires_photo,
            order_index: item.order_index,
            is_completed: false,
            is_custom: false
        }))

        const { data: newItems, error: newItemsError } = await supabase
            .from('checklist_items')
            .insert(itemsToInsert)
            .select()

        if (newItemsError) {
            console.error('[createChecklistFromFiche] Erreur création items:', newItemsError)
            // Rollback: supprimer la checklist créée
            await supabase.from('checklists').delete().eq('id', newChecklist.id)
            return { data: null, error: 'Erreur création items' }
        }

        console.log('[createChecklistFromFiche] Items créés:', newItems.length)
        console.log('[createChecklistFromFiche] ✅ SUCCESS - Checklist ID:', newChecklist.id)

        return { data: newChecklist.id, error: null }

    } catch (error) {
        console.error('[createChecklistFromFiche] Exception:', error)
        return { data: null, error: error.message }
    }
}
