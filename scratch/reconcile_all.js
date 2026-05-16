const CounterSyncService = require('../backend/services/counterSyncService');
const db = require('../backend/db');

async function run() {
    try {
        console.log('--- Iniciando Reconciliación Global de Contadores ---');
        const result = await CounterSyncService.sincronizarTodas();
        console.log('--- Reconciliación Finalizada ---');
        console.log('Resultado:', result);
        process.exit(0);
    } catch (error) {
        console.error('Error durante la reconciliación:', error);
        process.exit(1);
    }
}

run();
