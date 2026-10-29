import { emitKeypressEvents } from 'node:readline';
/** Applies one key to the picker state. */
export function pickerStep(state, key, targets) {
    const checked = new Set(state.checked);
    if (key === 'up')
        return { cursor: (state.cursor - 1 + targets.length) % targets.length, checked };
    if (key === 'down')
        return { cursor: (state.cursor + 1) % targets.length, checked };
    if (key === 'all') {
        const all = targets.every((t) => checked.has(t.id));
        return { cursor: state.cursor, checked: all ? new Set() : new Set(targets.map((t) => t.id)) };
    }
    const id = targets[state.cursor].id;
    if (checked.has(id))
        checked.delete(id);
    else
        checked.add(id);
    return { cursor: state.cursor, checked };
}
/** The picker as text, one line per target. */
export function renderPicker(state, targets, notes) {
    const rows = targets.map((t, i) => {
        const pointer = i === state.cursor ? '>' : ' ';
        const box = state.checked.has(t.id) ? '[x]' : '[ ]';
        const note = notes.get(t.id);
        return `${pointer} ${box} ${t.label}${note ? `  (${note})` : ''}`;
    });
    return ['Pick what to build: arrows move, space picks, a picks all, enter builds.', ...rows].join('\n');
}
/** Shows the list in the terminal and resolves with the picked ids, or null if the developer quits. */
export function pickTargets(targets, initial, notes) {
    const { stdin, stdout } = process;
    let state = { cursor: 0, checked: new Set(initial) };
    let drawn = 0;
    const draw = () => {
        if (drawn)
            stdout.write(`\x1b[${drawn}A\x1b[0J`);
        const text = renderPicker(state, targets, notes);
        stdout.write(`${text}\n`);
        drawn = text.split('\n').length;
    };
    return new Promise((resolve) => {
        emitKeypressEvents(stdin);
        stdin.setRawMode(true);
        stdin.resume();
        const finish = (result) => {
            stdin.off('keypress', onKey);
            stdin.setRawMode(false);
            stdin.pause();
            resolve(result);
        };
        const onKey = (_text, key) => {
            if ((key.name === 'c' && key.ctrl) || key.name === 'escape' || key.name === 'q') {
                finish(null);
                return;
            }
            if (key.name === 'return') {
                finish(targets.filter((t) => state.checked.has(t.id)).map((t) => t.id));
                return;
            }
            const named = { up: 'up', k: 'up', down: 'down', j: 'down', space: 'toggle', a: 'all' };
            const picked = key.name ? named[key.name] : undefined;
            if (!picked)
                return;
            state = pickerStep(state, picked, targets);
            draw();
        };
        stdin.on('keypress', onKey);
        draw();
    });
}
