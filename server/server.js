const fastify = require('fastify')({ logger: true });
const crypto = require('crypto');
const fastifyCors = require('@fastify/cors');
const { BlobServiceClient } = require('@azure/storage-blob');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { ServiceActionType } = require('@prisma/client');
const bcrypt = require('bcrypt');

fastify.register(require('@fastify/multipart'));

const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER || 'default-container';

const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(containerName);

async function createContainer() {
    try {
        await containerClient.createIfNotExists();
        console.log('Container created or already exists');
    } catch (error) {
        console.error('Error creating container:', error.message);
    }
}

createContainer();

fastify.register(fastifyCors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

const prisma = new PrismaClient();

/**
 * Generates token.
 *
 * @returns {string} A randomly generated token in hexadecimal format.
 */
function generateToken() {
    return crypto.randomBytes(16).toString('hex');
}

// Authentication Middleware
fastify.decorate('authenticate', async (request, reply) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
    }

    const authToken = authHeader.split(' ')[1];
    const user = await prisma.user.findUnique({ where: { token: authToken } });

    if (!user) {
        return reply.code(401).send({ error: 'Invalid auth token' });
    }

    request.user = user;
});

// User Registration
fastify.post('/register', async (request, reply) => {
    const { name, email, password } = request.body;
    const token = generateToken();

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                token,
            },
        });
        return reply.send({ message: 'User registered successfully', newUser, token });
    } catch (err) {
        return reply.send({ error: 'User registration failed', full_err: err });
    }
});

// User Login
fastify.post('/login', async (request, reply) => {
    const { name, password } = request.body;

    const user = await prisma.user.findUnique({ where: { name, password } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return reply.send({ error: 'Invalid credentials' });
    }

    return reply.send({ message: 'User logged successfully', user, toke: user.token });
});

async function streamToBuffer(readableStream) {
    const chunks = [];
    for await (const chunk of readableStream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

function dd(data) {
    console.log(data);
    process.exit();
}

// File Upload
fastify.post('/upload', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    try {
        const data = await request.file();

        if (!data) {
            return reply.status(400).send({ error: 'No file provided' });
        }

        // why this is promise?
        const user = await request.user;

        const blobName = `${user.uuid}$${data.filename}$${Date.now()}`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        const buffer = await data.toBuffer();

        const uploadBlobResponse = await blockBlobClient.upload(buffer, buffer.length);
        fastify.log.info(`Uploaded to Azure Blob Storage: ${blobName}`);
        const blobPath = blockBlobClient.url;

        await prisma.file.create({
            data: {
                name: blobName,
                blobPath: blobPath,
                userId: user.id,
            },
        });

        await prisma.serviceActionLog.create({
            data: {
                userId: user.id,
                action: ServiceActionType.UPLOAD,
            },
        });

        return reply.send({ uploaded: true, blobName });
    } catch (err) {
        fastify.log.error('Error during file upload:', err);
        return reply.status(500).send({ error: 'File upload failed', full_err: err });
    }
});

fastify.get('/files', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    try {
        const blobList = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            blobList.push(blob.name);
        }
        reply.send(blobList);
    } catch (err) {
        reply.send(err);
    }
});

fastify.get(
    '/download/:filename',
    { preValidation: [fastify.authenticate] },
    async (request, reply) => {
        const { filename } = request.params;

        try {
            const blockBlobClient = containerClient.getBlockBlobClient(filename);
            const downloadResponse = await blockBlobClient.download(0);
            const downloadedContent = await streamToBuffer(downloadResponse.readableStreamBody);

            await prisma.serviceActionLog.create({
                data: {
                    userId: request.user.id,
                    action: ServiceActionType.DOWNLOAD,
                    filename,
                },
            });

            reply.header('Content-Disposition', `attachment; filename="${filename}"`);
            reply.send(downloadedContent);
        } catch (err) {
            reply.send(err);
        }
    }
);

// Health check endpoint
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', message: 'Service is running' };
});

const APP_PORT = process.env.APP_PORT || 3000;

fastify.listen({ port: APP_PORT }, err => {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    } else {
        fastify.log.info(`Server is running on http://localhost:${APP_PORT}`);
    }
});
