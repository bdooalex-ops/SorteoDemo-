const db = require('knex')(require('./backend/knexfile').development);
db('rifas').select('id', 'slug', 'activa_publica').then(rifas => {
    console.log(rifas);
    process.exit(0);
}).catch(console.error);
