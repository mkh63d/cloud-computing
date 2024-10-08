const authController = require('../controllers/authController.js');
const { authenticate } = require('../middlewares/authMiddleware');

function authRoutes(fastify, options, next) {
    fastify.post('/register', authController.register);
    fastify.post('/login', authController.login);

    next();
}

module.exports = authRoutes;
