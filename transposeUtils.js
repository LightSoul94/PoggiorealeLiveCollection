// transposeUtils.js
export const notazioneLatinaDiesis = ['DO', 'DO#', 'RE', 'RE#', 'MI', 'FA', 'FA#', 'SOL', 'SOL#', 'LA', 'LA#', 'SI'];

export const bemolleToDiesis = {
    'REb': 'DO#', 'MIb': 'RE#', 'SOLb': 'FA#', 'LAb': 'SOL#', 'SIb': 'LA#'
};

export const diesisToBemolle = {
    'DO#': 'REb', 'RE#': 'MIb', 'FA#': 'SOLb', 'SOL#': 'LAb', 'LA#': 'SIb'
};

export function containsChord(text) {
    const chordRegex = /^(DO|RE|MI|FA|SOL|LA|SI)([#b]?)(m?|dim?)(\d*)(\/(DO|RE|MI|FA|SOL|LA|SI)([#b]?)(m?|dim?)?)?$/;
    return chordRegex.test(text);
}

export function transposeChord(chord, semitone) {
    let parts = chord.split('/');
    parts = parts.map(part => {
        let match = part.match(/^([A-Z]+)([#b]?)(m?|dim?)(\d*)$/);
        if (!match) return part;

        let baseChord = match[1].toUpperCase();
        let alteration = match[2] || '';
        let chordType = match[3] || '';
        let extension = match[4] || '';

        if (alteration === 'b' && bemolleToDiesis[baseChord + alteration]) {
            baseChord = bemolleToDiesis[baseChord + alteration];
            alteration = '';
        }

        let index = notazioneLatinaDiesis.indexOf(baseChord + alteration);
        if (index !== -1) {
            let newIndex = (index + semitone) % notazioneLatinaDiesis.length;
            if (newIndex < 0) newIndex += notazioneLatinaDiesis.length;

            let transposedChord = notazioneLatinaDiesis[newIndex];
            if (semitone < 0 && diesisToBemolle[transposedChord]) {
                transposedChord = diesisToBemolle[transposedChord];
            }

            return transposedChord + (chordType === 'dim' ? 'dim' : (chordType === 'm' ? 'm' : '')) + extension;
        }
        return part;
    });
    return parts.join('/');
}