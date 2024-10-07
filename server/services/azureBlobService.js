const { BlobServiceClient } = require('@azure/storage-blob');

const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER || 'default-container';

const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(containerName);

async function createContainer() {
    try {
        await containerClient.createIfNotExists();
        console.log(`Container ${containerName} exists`);
    } catch (err) {
        console.error('Error creating container:', err.message);
    }
}
createContainer();

module.exports = {
    containerClient,
};
