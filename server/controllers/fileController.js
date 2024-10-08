const prisma = require('../services/prismaService.js');
const { ServiceActionType } = require('@prisma/client');
const { containerClient } = require('../services/azureBlobService.js');

exports.index = async (request, reply) => {
    try {
        const blobList = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            blobList.push(blob.name);
        }
        reply.send(blobList);
    } catch (err) {
        reply.send(err);
    }
};

exports.store = async (request, reply) => {
    // think about adding here transactions to avoid saving file in db if it's not uploaded to blob storage
    try {
        const data = await request.file();

        if (!data) {
            return reply.status(400).send({ error: 'No file provided' });
        }

        const user = await request.user;
        const blobName = `${user.uuid}___${data.filename}___${Date.now()}`;

        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        const blobPath = blockBlobClient.url;

        // with huge files, pivot to streams
        const buffer = await data.toBuffer();

        const uploadBlobResponse = await blockBlobClient.upload(buffer, buffer.length);

        if (uploadBlobResponse._response.status !== 201) {
            throw new Error(
                'Blob upload failed with status: ' + uploadBlobResponse._response.status
            );
        }

        await prisma.file.create({
            data: {
                name: blobName,
                blobPath,
                userId: user.id,
            },
        });

        await prisma.serviceActionLog.create({
            data: {
                userId: user.id,
                action: ServiceActionType.UPLOAD,
            },
        });

        reply.send({ uploaded: true, blobName });
    } catch (err) {
        reply.status(500).send({ error: 'File upload failed', message: err.message });
    }
};

exports.multistore = async (request, reply) => {
    try {
        const parts = request.files();
        const user = await request.user;

        const successfulUploads = [];
        const failedUploads = [];

        //TODO: make it run in parallel
        for await (const part of parts) {
            if (part.type === 'file') {
                try {
                    const blobName = `${Date.now()}___${user.uuid}___${part.filename}`;
                    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
                    const blobPath = blockBlobClient.url;

                    const uploadBlobResponse = await blockBlobClient.uploadStream(part.file);
                    const properties = await blockBlobClient.getProperties();

                    const fileSize = properties.contentLength;

                    const file = await prisma.file.create({
                        data: {
                            name: part.filename,
                            blobPath,
                            userId: user.id,
                            size: fileSize,
                        },
                    });

                    await prisma.serviceActionLog.create({
                        data: {
                            userId: user.id,
                            fileId: file.id,
                            action: ServiceActionType.UPLOAD,
                        },
                    });
                    // await pump(part.file, fs.createWriteStream(`./uploads/${part.filename}`));

                    successfulUploads.push({
                        filename: part.filename,
                        blobName,
                        size: fileSize,
                    });
                } catch (fileError) {
                    console.error(`Failed to upload file: ${part.filename}`, fileError);
                    failedUploads.push({
                        filename: part.filename,
                        error: fileError.message,
                    });
                }
            }
        }

        reply.send({
            uploaded: successfulUploads.length,
            message:
                successfulUploads.length > 0
                    ? 'Files uploaded successfully'
                    : 'No files were uploaded',
            successfulUploads,
            failedUploads,
        });
    } catch (err) {
        console.error('Error in multistore:', err);
        reply.status(500).send({ error: 'File upload failed', message: err.message });
    }
};

async function streamToBuffer(readableStream) {
    const chunks = [];
    for await (const chunk of readableStream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

exports.download = async (request, reply) => {
    const { filename } = request.params;

    const user = await request.user;

    try {
        const blockBlobClient = containerClient.getBlockBlobClient(filename);
        const downloadResponse = await blockBlobClient.download(0);
        const downloadedContent = await streamToBuffer(downloadResponse.readableStreamBody);

        await prisma.serviceActionLog.create({
            data: {
                userId: user.id,
                action: ServiceActionType.DOWNLOAD,
            },
        });

        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.send(downloadedContent);
    } catch (err) {
        reply.send(err);
    }
};
