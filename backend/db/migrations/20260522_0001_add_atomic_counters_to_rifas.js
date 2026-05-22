/**
 * 📊 MIGRACIÓN: Contadores Atómicos de Boletos y Oportunidades en Tabla Rifas (Legacy)
 * 
 * Esta migración añade las columnas:
 * - total_vendidos
 * - total_apartados
 * - total_oportunidades_vendidas
 * - total_oportunidades_apartadas
 * 
 * Y realiza una sincronización inicial basada en el estado real actual de los boletos.
 */

exports.up = async function (knex) {
  console.log('🚀 Iniciando migración: Añadir columnas de contadores atómicos a la tabla "rifas" (Legacy)...');

  // 1. Crear las columnas de contadores si no existen
  const hasVendidos = await knex.schema.hasColumn('rifas', 'total_vendidos');
  if (!hasVendidos) {
    console.log('📦 Añadiendo columnas de contadores a la tabla rifas...');
    await knex.schema.table('rifas', (table) => {
      table.integer('total_vendidos').defaultTo(0);
      table.integer('total_apartados').defaultTo(0);
      table.integer('total_oportunidades_vendidas').defaultTo(0);
      table.integer('total_oportunidades_apartadas').defaultTo(0);
    });
    console.log('✅ Columnas añadidas con éxito.');
  } else {
    console.log('ℹ️ Las columnas de contadores ya existen en la tabla "rifas".');
  }

  // 2. Sincronización Inicial (Ground Truth)
  console.log('🔄 Sincronizando datos actuales de contadores...');
  const rifas = await knex('rifas').select('id', 'nombre');

  for (const rifa of rifas) {
    console.log(`   Analizando rifa: "${rifa.nombre}" (ID: ${rifa.id})...`);

    // Contar boletos principales por estado
    const statsBoletos = await knex('boletos_estado')
      .where('rifa_id', rifa.id)
      .select('estado')
      .count('* as count')
      .groupBy('estado');

    let vendidos = 0;
    let apartados = 0;
    statsBoletos.forEach((row) => {
      const cnt = parseInt(row.count || 0);
      if (row.estado === 'vendido') vendidos = cnt;
      if (row.estado === 'apartado') apartados = cnt;
    });

    // Contar oportunidades por estado (si existe la tabla orden_oportunidades)
    let oppVendidas = 0;
    let oppApartadas = 0;
    const hasOppTable = await knex.schema.hasTable('orden_oportunidades');
    
    if (hasOppTable) {
      const statsOpp = await knex('orden_oportunidades')
        .where('rifa_id', rifa.id)
        .select('estado')
        .count('* as count')
        .groupBy('estado');

      statsOpp.forEach((row) => {
        const cnt = parseInt(row.count || 0);
        if (row.estado === 'vendido') oppVendidas = cnt;
        if (row.estado === 'apartado') oppApartadas = cnt;
      });
    }

    // Actualizar los contadores en la tabla rifas para esta rifa específica
    await knex('rifas')
      .where('id', rifa.id)
      .update({
        total_vendidos: vendidos,
        total_apartados: apartados,
        total_oportunidades_vendidas: oppVendidas,
        total_oportunidades_apartadas: oppApartadas,
        updated_at: new Date()
      });

    console.log(`      ✨ Stats sincronizadas para Rifa ${rifa.id}: ${vendidos} vendidos, ${apartados} apartados, ${oppVendidas} opp vendidas, ${oppApartadas} opp apartadas.`);
  }

  console.log('⭐ Migración de contadores atómicos completada con éxito.');
};

exports.down = async function (knex) {
  console.log('↩️ Revirtiendo migración: Eliminar columnas de contadores de la tabla "rifas" (Legacy)...');

  const hasVendidos = await knex.schema.hasColumn('rifas', 'total_vendidos');
  if (hasVendidos) {
    await knex.schema.table('rifas', (table) => {
      table.dropColumn('total_vendidos');
      table.dropColumn('total_apartados');
      table.dropColumn('total_oportunidades_vendidas');
      table.dropColumn('total_oportunidades_apartadas');
    });
    console.log('✅ Columnas de contadores eliminadas exitosamente.');
  } else {
    console.log('ℹ️ Las columnas de contadores no existen en la tabla "rifas".');
  }
};
