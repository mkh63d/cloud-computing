const bcrypt = require('bcrypt');
const prisma = require('../services/prismaService');
const generateAuthToken = require('../helpers/generateAuthToken');

exports.register = async (request, reply) => {
    const { name, email, password } = request.body;

    // add more graceful request validation
    if (!name || !email || !password) {
        return reply.code(400).send({ error: 'Name, email, and password are required' });
    }

    const token = generateAuthToken();
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return reply.code(409).send({ error: 'Email is already registered' });
        }

        const newUser = await prisma.user.create({
            data: { name, email, password: hashedPassword, token },
        });

        reply.send({ message: 'User registered successfully', newUser, token });
    } catch (err) {
        if (err.code === 'P2002') {
            return reply.code(409).send({
                error: 'User registration failed: Email is already taken',
            });
        }

        reply.code(500).send({ error: 'User registration failed', err });
    }
};

exports.login = async (request, reply) => {
    try {
        const { email, password } = request.body;

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return reply.code(401).send({ error: 'Invalid credentials' });
        }

        return reply.send({ message: 'User logged in successfully', user, token: user.token });
    } catch (err) {
        return reply.code(500).send({ error: 'Login failed', err: err });
    }
};
