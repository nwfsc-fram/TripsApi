// Babel config to comply with babel-jest requirements
module.exports = {
    presets: ['@babel/preset-env', '@babel/preset-typescript'],
    env: {
        test: {
            presets: [['@babel/preset-env']]
        }
    }
};