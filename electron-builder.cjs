const { createPackageConfig } = require('./scripts/package-config.cjs');
module.exports = createPackageConfig(process.env, process.platform);
