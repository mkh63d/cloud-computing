const crypto = require('crypto');

function generateAuthToken() {
    return crypto.randomBytes(16).toString('hex');
}

module.exports = generateAuthToken;
