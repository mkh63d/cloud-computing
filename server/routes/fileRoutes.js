const fileController = require('../controllers/fileController');
const { authenticate } = require('../middlewares/authMiddleware');

function fileRoutes(fastify, options, next) {
    fastify.get('/list', { preValidation: [authenticate] }, fileController.list);
    fastify.post('/upload-multiple', { preValidation: [authenticate] }, fileController.multistore);
    fastify.post('/download-multiple', { preValidation: [authenticate] }, fileController.multiDownload);

    next();
}

module.exports = fileRoutes;
