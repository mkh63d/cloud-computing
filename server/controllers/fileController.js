const JSZip = require('jszip');

const prisma = require('../services/prismaService.js');
const { ServiceActionType } = require('@prisma/client');
const { containerClient } = require('../services/azureBlobService.js');

exports.list = async (request, reply) => {
    try {
        const user = await request.user;
        const { page = 1, limit = 30 } = request.query;

        const pageNumber = parseInt(page);
        const pageSize = parseInt(limit);

        const totalFiles = await prisma.file.count({
            where: {
                userId: user.id,
            },
        });
        const skip = (pageNumber - 1) * pageSize; // offset

        const userFiles = await prisma.file.findMany({
            where: {
                userId: user.id,
            },
            select: {
                uuid: true,
                name: true,
                size: true,
                createdAt: true,
            },
            skip: skip,
            take: pageSize,
        });

        reply.send({
            totalFiles,
            totalPages: Math.ceil(totalFiles / pageSize),
            currentPage: pageNumber,
            files: userFiles,
        });
    } catch (err) {
        console.error('Error in fetching paginated file list:', err);
        reply.status(500).send({ error: 'Failed to list files', message: err.message });
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
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', chunk => chunks.push(chunk));
        readableStream.on('end', () => resolve(Buffer.concat(chunks)));
        readableStream.on('error', reject);
    });
}

exports.multiDownload = async (request, reply) => {
    try {
        const { filesUuids } = request.body;
        const user = await request.user;

        const files = await prisma.file.findMany({
            where: {
                uuid: {
                    in: filesUuids,
                },
                userId: user.id,
            },
        });

        if (files.length !== filesUuids.length) {
            return reply.status(404).send({
                error: 'Some files were not found or do not belong to currently logged user',
            });
        }

        const zip = new JSZip();

        for (const file of files) {
            try {
                const blobName = file.blobPath.split('/').pop();
                const blockBlobClient = containerClient.getBlockBlobClient(blobName);
                const downloadResponse = await blockBlobClient.download(0);

                const downloadedBufferedContent = await streamToBuffer(
                    downloadResponse.readableStreamBody
                );

                zip.file(file.name, downloadedBufferedContent);
            } catch (err) {
                console.error(`Error while downloading file: ${file.blobPath}`, err);
                return reply.status(500).send({ error: `Failed to download file: ${file.name}` });
            }
        }

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

        await prisma.serviceActionLog.createMany({
            data: files.map(file => ({
                userId: user.id,
                fileId: file.id,
                action: ServiceActionType.DOWNLOAD,
            })),
        });

        const attachmentName = String(Date.now()) + '_downloaded_files.zip';
        reply
            .header('Content-Disposition', `attachment; filename="${attachmentName}"`)
            .header('Content-Type', 'application/zip')
            .send(zipBuffer);
    } catch (err) {
        console.error('Error in multipleDownload:', err);
        reply.status(500).send({ error: 'Download failed', message: err.message });
    }
};
