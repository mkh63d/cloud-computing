const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs').promises;
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const fastifyCors = require('@fastify/cors');
const { BlobServiceClient } = require('@azure/storage-blob');
require('dotenv').config();

fastify.register(require('@fastify/multipart'));

const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;

const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient('mycontainer');

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

const db = new sqlite3.Database('./file_log.db');

db.serialize(() => {
    db.run(
        `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, password TEXT, token TEXT)`
    );
    db.run(
        `CREATE TABLE IF NOT EXISTS file_logs (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, filename TEXT, timestamp TEXT)`
    );
});

/**
 * Generates token.
 *
 * @returns {string} A randomly generated token in hexadecimal format.
 */
function generateToken() {
    return crypto.randomBytes(16).toString('hex');
}

fastify.decorate('authenticate', (request, reply, done) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    db.get(`SELECT * FROM users WHERE token = ?`, [token], (err, user) => {
        if (err || !user) {
            return reply.code(401).send({ error: 'Invalid token' });
        }
        request.user = user;
        done();
    });
});

fastify.post('/register', (request, reply) => {
    const { username, password } = request.body;
    const token = generateToken();

    db.run(
        `INSERT INTO users (username, password, token) VALUES (?, ?, ?)`,
        [username, password, token],
        function (err) {
            if (err) return reply.send(err);
            reply.send({ message: 'User registered', token });
        }
    );
});

fastify.post('/login', (request, reply) => {
    const { username, password } = request.body;

    db.get(
        `SELECT * FROM users WHERE username = ? AND password = ?`,
        [username, password],
        (err, user) => {
            if (err || !user) return reply.send({ error: 'Invalid credentials' });
            reply.send({ token: user.token });
        }
    );
});

async function streamToBuffer(readableStream) {
    const chunks = [];
    for await (const chunk of readableStream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdir(uploadsDir, { recursive: true })
    .then(() => fastify.log.info('Uploads directory is ready'))
    .catch(err => fastify.log.error('Error creating uploads directory:', err));

fastify.post('/upload', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    try {
        const data = await request.file();

        if (!data) {
            return reply.status(400).send({ error: 'No file provided' });
        }

        const filename = data.filename;

        const blockBlobClient = containerClient.getBlockBlobClient(filename);

        const buffer = await data.toBuffer();

        await blockBlobClient.upload(buffer, buffer.length);
        fastify.log.info(`Uploaded to Azure Blob Storage: ${filename}`);

        db.run(
            `INSERT INTO file_logs (user_id, action, filename, timestamp) VALUES (?, ?, ?, ?)`,
            [request.user.id, 'UPLOAD', filename, new Date().toISOString()],
            err => {
                if (err) {
                    fastify.log.error('Error logging file upload to database:', err);
                    return reply
                        .code(500)
                        .send({ error: 'Database logging failed', full_err: err });
                }
            }
        );

        return reply.send({ uploaded: true, filename });
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

            reply.header('Content-Disposition', `attachment; filename="${filename}"`);
            reply.send(downloadedContent);

            db.run(
                `INSERT INTO file_logs (user_id, action, filename, timestamp) VALUES (?, ?, ?, ?)`,
                [request.user.id, 'DOWNLOAD', filename, new Date().toISOString()]
            );
        } catch (err) {
            reply.send(err);
        }
    }
);

fastify.get('/', function handler(request, reply) {
    reply.send({ hello: 'world' });
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
