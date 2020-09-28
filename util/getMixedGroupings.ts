const dbConfig = require('../dbConfig.json').dbConfig;
const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev');
const jp = require('jsonpath');

async function getSpeciesCodesForGrouping(children: string[], speciesCodes: string[]) {
    for (const child of children) {
        const species = await masterDev.view('Taxonomy', 'taxonomy-alias-by-taxonomy-id',
            { "include_docs": true, "key": child });
        const result = species.rows[0].doc;

        if (result.pacfinSpeciesCode) {
            speciesCodes.push(result.pacfinSpeciesCode);
        }
        if (result.wcemSpeciesCode) {
            speciesCodes.push(result.wcemSpeciesCode.toString());
        }
        if (result.taxonomy && result.taxonomy.children) {
            await getSpeciesCodesForGrouping(result.taxonomy.children, speciesCodes);
        }
    }
    return speciesCodes;
}

export async function getMixedGroupingInfo() {
    const mixedGroupings = await masterDev.view('em-views', 'mixed-groupings', { include_docs: true });
    const mixedGroupingsMap = {};
    for (const mixedGrouping of mixedGroupings.rows) {
        let speciesCode = mixedGrouping.key;
        let species: string[] = [];

        if (typeof speciesCode === 'number') {
            speciesCode = speciesCode.toString();
        }
        if (mixedGrouping.doc.taxonomy && mixedGrouping.doc.taxonomy.children) {
            species = await getSpeciesCodesForGrouping(mixedGrouping.doc.taxonomy.children, [])
        }
        mixedGroupingsMap[speciesCode] = species;
    }
    return mixedGroupingsMap;
}

getMixedGroupingInfo();