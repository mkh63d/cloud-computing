const prisma = require('../services/prismaService');

exports.authenticate = async (request, reply) => {
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Not able to retrieve auth header from request' });
    }

    const authToken = authHeader.split(' ')[1];

    const user = await prisma.user.findUnique({ where: { token: authToken } });

    if (!user) {
        return reply.code(401).send({ error: 'Invalid auth token' });
    }

    request.user = user;
};
