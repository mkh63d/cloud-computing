const fastify = require('fastify')({ logger: true });
// fastify.log.level = 'debug';
require('dotenv').config();

fastify.register(require('@fastify/multipart'), {
    limits: {
        fileSize: 50 * 1024 * 1024, // max file size to 50MB
    },
});
const fastifyCors = require('@fastify/cors');

fastify.register(fastifyCors, { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] });

fastify.register(require('./routes/authRoutes'));
fastify.register(require('./routes/fileRoutes'), { prefix: '/files' });

// Health check endpoint
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', message: 'Service is running' };
});

const APP_PORT = process.env.APP_PORT || process.env.port || 3000;

fastify.listen({ port: APP_PORT, host: '0.0.0.0' }, err => {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    } else {
        //
    }
});
