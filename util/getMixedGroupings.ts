import { TaxonomyAlias } from "@boatnet/bn-models/lib";
import { masterDev } from './couchDB';

const jp = require('jsonpath');

async function getSpeciesCodesForGrouping(children: string[], speciesCodes: any[]) {
    for (const child of children) {
        const species = await masterDev.view('Taxonomy', 'taxonomy-alias-by-taxonomy-id',
            { "include_docs": true, "key": child });
        const result = species.rows[0].doc;

        if (result.pacfinSpeciesCode) {
            speciesCodes.push(result.pacfinSpeciesCode.toString());
        }
        if (result.wcgopSpeciesCode) {
            speciesCodes.push(parseInt(result.wcgopSpeciesCode, 10));
        }
        if (result.taxonomy && result.taxonomy.children) {
            await getSpeciesCodesForGrouping(result.taxonomy.children, speciesCodes);
        }
    }
    return speciesCodes;
}

function getMembershipSpeciesCodes(members: any[]) {
    const speciesCodes: any = [];
    for (const member of members) {
        if (member.wcgopSpeciesCode) {
            speciesCodes.push(parseInt(member.wcgopSpeciesCode, 10));
        }
        if (member.pacfinSpeciesCode) {
            speciesCodes.push(member.pacfinSpeciesCode.toString());
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
            species = await getSpeciesCodesForGrouping(mixedGrouping.doc.taxonomy.children, []);
        }
        if (mixedGrouping.doc.members && mixedGrouping.doc.members.length > 0) {
            species = getMembershipSpeciesCodes(mixedGrouping.doc.members)
        }
        mixedGroupingsMap[speciesCode] = species;
    }
    return mixedGroupingsMap;
}
