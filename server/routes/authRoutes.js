const authController = require('../controllers/authController.js');
const { authenticate } = require('../middlewares/authMiddleware');

function authRoutes(fastify, options, next) {
    fastify.post('/register', { preValidation: [authenticate] }, authController.register);
    fastify.post('/login', authController.login);

    next();
}

module.exports = authRoutes;
