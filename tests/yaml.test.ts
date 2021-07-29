
test('verify test environment', () => {
    expect(true).toBe(true);
});


import * as path from 'path';
import * as YAML from 'yamljs';

test('OpenAPI.yaml import', () => {
    const swaggerDocument = YAML.load(path.resolve(__dirname, '../openapi.yaml'));
    expect(swaggerDocument).toBeTruthy();
})
