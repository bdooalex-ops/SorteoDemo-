const db = require('../db');

/**
 * Servicio de Sincronización de Contadores Atómicos
 * =================================================
 * Realiza un conteo real de la tabla boletos_estado y orden_oportunidades
 * para actualizar los contadores en la tabla rifas.
 * 
 * Útil para corregir desviaciones (drift) causadas por errores inesperados,
 * migraciones manuales o intervenciones directas en la base de datos.
 */
class CounterSyncService {
    /**
     * Sincroniza los contadores de una rifa específica
     * @param {number} rifaId - ID de la rifa a sincronizar
     * @param {object} trx - Opcional: instancia de transacción Knex
     */
    static async sincronizarRifa(rifaId, trx = null) {
        if (!rifaId) throw new Error('rifaId es requerido para sincronizar contadores');

        const runner = trx || db;

        try {
            console.log(`[CounterSync] Sincronizando contadores para rifa:${rifaId}...`);

            // 1. Contar boletos principales por estado
            const statsBoletos = await runner('boletos_estado')
                .where('rifa_id', rifaId)
                .select('estado')
                .count('* as count')
                .groupBy('estado');

            const counts = {
                vendido: 0,
                apartado: 0
            };

            statsBoletos.forEach(row => {
                if (row.estado === 'vendido') counts.vendido = parseInt(row.count) || 0;
                if (row.estado === 'apartado') counts.apartado = parseInt(row.count) || 0;
            });

            // 2. Contar oportunidades por estado
            const statsOpps = await runner('orden_oportunidades')
                .where('rifa_id', rifaId)
                .select('estado')
                .count('* as count')
                .groupBy('estado');

            const countsOpps = {
                vendido: 0,
                apartado: 0
            };

            statsOpps.forEach(row => {
                if (row.estado === 'vendido') countsOpps.vendido = parseInt(row.count) || 0;
                if (row.estado === 'apartado') countsOpps.apartado = parseInt(row.count) || 0;
            });

            // 3. Actualizar tabla rifas
            await runner('rifas')
                .where('id', rifaId)
                .update({
                    total_vendidos: counts.vendido,
                    total_apartados: counts.apartado,
                    total_oportunidades_vendidas: countsOpps.vendido,
                    total_oportunidades_apartadas: countsOpps.apartado,
                    updated_at: new Date()
                });

            console.log(`[CounterSync] ✅ Sincronización exitosa rifa:${rifaId}`, {
                boletos: counts,
                oportunidades: countsOpps
            });

            return {
                success: true,
                rifaId,
                counts,
                countsOpps
            };
        } catch (error) {
            console.error(`[CounterSync] ❌ Error sincronizando rifa:${rifaId}:`, error.message);
            throw error;
        }
    }

    /**
     * Sincroniza todas las rifas activas
     */
    static async sincronizarTodas() {
        try {
            const rifas = await db('rifas').select('id');
            console.log(`[CounterSync] Iniciando sincronización global de ${rifas.length} rifas...`);
            
            for (const rifa of rifas) {
                await this.sincronizarRifa(rifa.id);
            }
            
            return { success: true, count: rifas.length };
        } catch (error) {
            console.error('[CounterSync] Error en sincronización global:', error.message);
            throw error;
        }
    }
}

module.exports = CounterSyncService;
