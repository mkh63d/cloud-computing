const fileController = require('../controllers/fileController');
const { authenticate } = require('../middlewares/authMiddleware');

function fileRoutes(fastify, options, next) {
    fastify.get('/list', { preValidation: [authenticate] }, fileController.index);
    fastify.post('/upload', { preValidation: [authenticate] }, fileController.store);
    fastify.get('/download/:filename', { preValidation: [authenticate] }, fileController.download);

    next();
}

module.exports = fileRoutes;
