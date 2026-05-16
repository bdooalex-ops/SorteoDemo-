const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const db = require('../backend/db');

async function runMigration() {
    console.log('🚀 Iniciando migración de contadores atómicos...');

    try {
        // 1. Crear las columnas si no existen
        const hasVendidos = await db.schema.hasColumn('rifas', 'total_vendidos');
        if (!hasVendidos) {
            console.log('📦 Añadiendo columnas de contadores a la tabla rifas...');
            await db.schema.alterTable('rifas', table => {
                table.integer('total_vendidos').defaultTo(0);
                table.integer('total_apartados').defaultTo(0);
                table.integer('total_oportunidades_vendidas').defaultTo(0);
                table.integer('total_oportunidades_apartadas').defaultTo(0);
            });
            console.log('✅ Columnas añadidas con éxito.');
        } else {
            console.log('ℹ️ Las columnas de contadores ya existen.');
        }

        // 2. Sincronización Inicial (Ground Truth)
        console.log('🔄 Sincronizando datos actuales...');
        const rifas = await db('rifas').select('id', 'nombre');

        for (const rifa of rifas) {
            console.log(`   Analizando rifa: ${rifa.nombre} (ID: ${rifa.id})...`);

            // Contar boletos principales
            const statsBoletos = await db('boletos_estado')
                .where('rifa_id', rifa.id)
                .select('estado')
                .count('* as count')
                .groupBy('estado');

            const vendidos = parseInt(statsBoletos.find(s => s.estado === 'vendido')?.count || 0);
            const apartados = parseInt(statsBoletos.find(s => s.estado === 'apartado')?.count || 0);

            // Contar oportunidades (si existe la tabla)
            let oppVendidas = 0;
            let oppApartadas = 0;
            const hasOppTable = await db.schema.hasTable('orden_oportunidades');
            
            if (hasOppTable) {
                const statsOpp = await db('orden_oportunidades')
                    .where('rifa_id', rifa.id)
                    .select('estado')
                    .count('* as count')
                    .groupBy('estado');

                oppVendidas = parseInt(statsOpp.find(s => s.estado === 'vendido')?.count || 0);
                oppApartadas = parseInt(statsOpp.find(s => s.estado === 'apartado')?.count || 0);
            }

            // Actualizar la rifa
            await db('rifas')
                .where('id', rifa.id)
                .update({
                    total_vendidos: vendidos,
                    total_apartados: apartados,
                    total_oportunidades_vendidas: oppVendidas,
                    total_oportunidades_apartadas: oppApartadas
                });

            console.log(`      ✨ Stats sincronizadas: ${vendidos} vendidos, ${apartados} apartados.`);
        }

        console.log('\n⭐ Migración completada con éxito.');
    } catch (error) {
        console.error('❌ Error durante la migración:', error);
    } finally {
        await db.destroy();
    }
}

runMigration();
