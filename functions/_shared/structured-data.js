import { extractSectionsFromDataJs } from './data-split.js';
import { parseDataLiteral } from './data-literal.js';

export function structuredSections(content, isAdmin) {
    const parts = extractSectionsFromDataJs(content);
    if (!parts) throw new Error('Missing sections array');
    // A mapped/concatenated initializer or later mutation is not a data literal.
    if (parts.after.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '').trim()) throw new Error('Executable suffix is unsupported');
    const sections = parseDataLiteral('[' + parts.body + '\n]');
    const keys = new Set();
    function validateCards(cards, depth = 0) {
        if (depth > 10 || !Array.isArray(cards)) throw new Error('Invalid cards');
        for (const card of cards) {
            if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('Invalid card');
            if (card.subCards !== undefined) validateCards(card.subCards, depth + 1);
        }
    }
    return sections.filter(section => {
        // Discard legacy ciphertext containers; never decode or expose them.
        if (section && (section.encrypted === true || section.locked === true || Object.hasOwn(section, 'enc') || Object.hasOwn(section, '_enc'))) return false;
        if (!section || typeof section.key !== 'string' || !section.key || keys.has(section.key)
            || !Array.isArray(section.cards)) throw new Error('Invalid section');
        keys.add(section.key);
        validateCards(section.cards);
        return isAdmin || section.private !== true;
    });
}
