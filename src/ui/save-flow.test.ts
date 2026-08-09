import { describe, expect, it } from 'vitest';

import { t } from '../i18n';
import { createSaveFlow, type SaveFlowDeps, type SaveFlowOptions, type SaveState } from './save-flow';

/**
 * These tests run in vitest's default node environment — there is no DOM here.
 * `SaveFlowElements` is declared as the property bag the flow actually touches,
 * so the fakes below are structurally the same thing a real element is from the
 * flow's point of view, and `tsc` proves the real elements in app.ts still fit.
 *
 * Everything asserted is observable state: what was written, what was recorded,
 * the class/disabled/textContent the user ends up looking at. Nothing here
 * asserts merely "the stub ran".
 */

/** Records add/remove instead of maintaining a set — order is what we assert. */
function fakeClassList() {
  const ops: string[] = [];
  return {
    ops,
    add(...tokens: string[]): void {
      for (const token of tokens) ops.push(`+${token}`);
    },
    remove(...tokens: string[]): void {
      for (const token of tokens) ops.push(`-${token}`);
    },
  };
}

function makeElements(initialName: string) {
  const saveBtnLabelClass = fakeClassList();
  const saveSpinnerClass = fakeClassList();
  const goToLocationClass = fakeClassList();
  const elements = {
    fileNameInput: { value: initialName },
    saveBtn: { disabled: false },
    saveBtnLabel: { textContent: 'Save', classList: saveBtnLabelClass },
    saveSpinner: { classList: saveSpinnerClass },
    actionStatus: { textContent: '' },
    goToLocationBtn: { classList: goToLocationClass },
  };
  return { elements, saveBtnLabelClass, saveSpinnerClass, goToLocationClass };
}

interface HarnessOverrides {
  result?: Uint8Array | null;
  targetDir?: SaveFlowOptions['targetDir'];
  savedStatusKey?: SaveFlowOptions['savedStatusKey'];
  fileName?: string;
  exists?: boolean;
  existsImpl?: (path: string) => Promise<boolean>;
  confirmAnswer?: boolean;
  confirmImpl?: (message: string) => Promise<boolean>;
  /** Runs while the confirm dialog is "open", before it answers. */
  onConfirm?: () => void;
  saveImpl?: (bytes: Uint8Array, relPath: string) => Promise<string>;
  recordImpl?: (entry: { uri: string | null; name: string }) => Promise<void>;
}

function makeHarness(overrides: HarnessOverrides = {}) {
  const dom = makeElements(overrides.fileName ?? 'report');

  const writes: { path: string; bytes: Uint8Array }[] = [];
  const recorded: { uri: string | null; name: string }[] = [];
  const existsChecks: string[] = [];
  const confirms: string[] = [];
  const toasts: string[] = [];

  let state: SaveState = 'idle';
  // `??` would swallow an intentional `result: null`, so check for the key.
  let result: Uint8Array | null =
    'result' in overrides ? (overrides.result ?? null) : new Uint8Array([1, 2, 3]);

  const deps: SaveFlowDeps = {
    async pathExists(path) {
      existsChecks.push(path);
      if (overrides.existsImpl) return overrides.existsImpl(path);
      return overrides.exists ?? false;
    },
    async savePdfPrivately(bytes, relPath) {
      if (overrides.saveImpl) return overrides.saveImpl(bytes, relPath);
      writes.push({ path: relPath, bytes });
      return `file:///data/${relPath}`;
    },
    async recordOpened(entry) {
      if (overrides.recordImpl) return overrides.recordImpl(entry);
      recorded.push(entry);
    },
    async showConfirmDialog(message) {
      confirms.push(message);
      overrides.onConfirm?.();
      if (overrides.confirmImpl) return overrides.confirmImpl(message);
      return overrides.confirmAnswer ?? true;
    },
    showToast(message) {
      toasts.push(message);
    },
    errorText(error) {
      return error instanceof Error ? error.message : String(error);
    },
  };

  const flow = createSaveFlow(
    {
      getResultPdf: () => result,
      targetDir: overrides.targetDir ?? 'edits',
      savedStatusKey: overrides.savedStatusKey ?? 'status.rotate.saved',
      getState: () => state,
      setState: (next) => { state = next; },
      elements: dom.elements,
    },
    deps,
  );

  return {
    ...dom,
    // Detached on purpose: app.ts passes these straight to addEventListener,
    // so they must not depend on `this`.
    save: flow.save,
    resetSavedState: flow.resetSavedState,
    writes,
    recorded,
    existsChecks,
    confirms,
    toasts,
    getState: () => state,
    setState: (next: SaveState) => { state = next; },
    setResult: (next: Uint8Array | null) => { result = next; },
  };
}

describe('createSaveFlow — successful save', () => {
  it('writes to <targetDir>/<name>.pdf, records it, and lands in the saved state', async () => {
    const h = makeHarness({ targetDir: 'merges', savedStatusKey: 'status.merge.saved' });

    await h.save();

    expect(h.writes).toEqual([
      { path: 'merges/report.pdf', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    expect(h.recorded).toEqual([{ uri: 'file:///data/merges/report.pdf', name: 'report.pdf' }]);
    expect(h.getState()).toBe('saved');
    expect(h.elements.actionStatus.textContent).toBe(t('status.merge.saved'));
    expect(h.elements.saveBtnLabel.textContent).toBe(t('common.saved'));
    expect(h.elements.saveBtn.disabled).toBe(true);
    // The name box drops the extension it displays, so re-saving is idempotent.
    expect(h.elements.fileNameInput.value).toBe('report');
    expect(h.goToLocationClass.ops).toEqual(['-hidden']);
  });

  it('leaves the spinner hidden and the label visible when it finishes', async () => {
    const h = makeHarness();

    await h.save();

    expect(h.saveSpinnerClass.ops).toEqual(['-hidden', '+hidden']);
    expect(h.saveBtnLabelClass.ops).toEqual(['+hidden', '-hidden']);
  });

  it('uses each tool status key rather than a shared one', async () => {
    const merge = makeHarness({ targetDir: 'merges', savedStatusKey: 'status.merge.saved' });
    const watermark = makeHarness({ savedStatusKey: 'status.watermark.saved' });

    await merge.save();
    await watermark.save();

    expect(merge.elements.actionStatus.textContent).toBe(t('status.merge.saved'));
    expect(watermark.elements.actionStatus.textContent).toBe(t('status.watermark.saved'));
    expect(merge.elements.actionStatus.textContent).not.toBe(
      watermark.elements.actionStatus.textContent,
    );
  });

  it('sanitizes the typed name before it becomes a path', async () => {
    const h = makeHarness({ fileName: '../etc/passwd' });

    await h.save();

    // Separators become underscores and the leading dots collapse, so the
    // result can never escape the target folder.
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].path).toBe('edits/__etc_passwd.pdf');
    expect(h.writes[0].path.startsWith('edits/')).toBe(true);
    expect(h.writes[0].path).not.toContain('..');
    expect(h.existsChecks).toEqual(['edits/__etc_passwd.pdf']);
  });

  it('keeps an already-.pdf name as one extension, not two', async () => {
    const h = makeHarness({ fileName: 'report.pdf' });

    await h.save();

    expect(h.writes[0].path).toBe('edits/report.pdf');
    expect(h.elements.fileNameInput.value).toBe('report');
  });
});

describe('createSaveFlow — overwrite confirmation', () => {
  it('asks before overwriting and writes when the user accepts', async () => {
    const h = makeHarness({ exists: true, confirmAnswer: true });

    await h.save();

    expect(h.confirms).toEqual([t('common.overwriteConfirm', { name: 'report.pdf' })]);
    expect(h.writes.map((w) => w.path)).toEqual(['edits/report.pdf']);
    expect(h.getState()).toBe('saved');
  });

  it('writes nothing and never starts the spinner when the user declines', async () => {
    const h = makeHarness({ exists: true, confirmAnswer: false });

    await h.save();

    expect(h.confirms).toHaveLength(1);
    expect(h.writes).toEqual([]);
    expect(h.recorded).toEqual([]);
    expect(h.getState()).toBe('idle');
    expect(h.elements.saveBtn.disabled).toBe(false);
    // Nothing touched the spinner or the label: the flow returned before the
    // state machine started, so the button still reads "Save".
    expect(h.saveSpinnerClass.ops).toEqual([]);
    expect(h.saveBtnLabelClass.ops).toEqual([]);
    expect(h.goToLocationClass.ops).toEqual([]);
    expect(h.elements.actionStatus.textContent).toBe('');
  });

  it('does not ask when nothing is at the target path', async () => {
    const h = makeHarness({ exists: false });

    await h.save();

    expect(h.existsChecks).toEqual(['edits/report.pdf']);
    expect(h.confirms).toEqual([]);
    expect(h.writes).toHaveLength(1);
  });
});

describe('createSaveFlow — rejected input', () => {
  it('toasts and stops on a name that sanitizes to nothing', async () => {
    const h = makeHarness({ fileName: '   ' });

    await h.save();

    expect(h.toasts).toEqual([t('toast.invalidFileName')]);
    expect(h.existsChecks).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.getState()).toBe('idle');
    expect(h.saveSpinnerClass.ops).toEqual([]);
    expect(h.elements.saveBtn.disabled).toBe(false);
  });

  it('treats a dots-and-underscores-only name as invalid', async () => {
    const h = makeHarness({ fileName: '...' });

    await h.save();

    expect(h.toasts).toEqual([t('toast.invalidFileName')]);
    expect(h.writes).toEqual([]);
  });

  it('does nothing at all when there is no result PDF yet', async () => {
    const h = makeHarness({ result: null });

    await h.save();

    expect(h.toasts).toEqual([]);
    expect(h.existsChecks).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.getState()).toBe('idle');
  });
});

describe('createSaveFlow — failures', () => {
  it('reports a failed write and returns the button to idle', async () => {
    const h = makeHarness({
      saveImpl: async () => { throw new Error('No space left on device'); },
    });

    await h.save();

    expect(h.elements.actionStatus.textContent).toBe(
      t('status.saveFailed', { message: 'No space left on device' }),
    );
    expect(h.elements.actionStatus.textContent).toContain('No space left on device');
    expect(h.getState()).toBe('idle');
    expect(h.elements.saveBtn.disabled).toBe(false);
    expect(h.recorded).toEqual([]);
    // Spinner shown then hidden again; label hidden then restored.
    expect(h.saveSpinnerClass.ops).toEqual(['-hidden', '+hidden']);
    expect(h.saveBtnLabelClass.ops).toEqual(['+hidden', '-hidden']);
    // No "go to location" for a file that was never written.
    expect(h.goToLocationClass.ops).toEqual([]);
  });

  it('reports failure when only the recents bookkeeping throws, though the file is on disk', async () => {
    // Pinning existing behaviour, not endorsing it: recordOpened is inside the
    // same try, so a recents failure presents to the user as a failed save.
    const h = makeHarness({
      recordImpl: async () => { throw new Error('recents unavailable'); },
    });

    await h.save();

    expect(h.writes).toHaveLength(1);
    expect(h.getState()).toBe('idle');
    expect(h.elements.actionStatus.textContent).toBe(
      t('status.saveFailed', { message: 'recents unavailable' }),
    );
  });

  it('survives a non-Error rejection', async () => {
    const h = makeHarness({ saveImpl: async () => { throw 'plain string'; } });

    await h.save();

    expect(h.elements.actionStatus.textContent).toBe(
      t('status.saveFailed', { message: 'plain string' }),
    );
    expect(h.getState()).toBe('idle');
  });
});

describe('createSaveFlow — resetSavedState (the name box "input" handler)', () => {
  it('drops the saved presentation once the user edits the name', async () => {
    const h = makeHarness();
    await h.save();
    expect(h.getState()).toBe('saved');

    h.elements.fileNameInput.value = 'report-v2';
    h.resetSavedState();

    expect(h.getState()).toBe('idle');
    expect(h.elements.saveBtn.disabled).toBe(false);
    expect(h.elements.saveBtnLabel.textContent).toBe(t('common.save'));
    // "Go to location" pointed at the old file, so it goes away.
    expect(h.goToLocationClass.ops).toEqual(['-hidden', '+hidden']);
  });

  it('does nothing at all while idle', () => {
    const h = makeHarness();

    h.resetSavedState();

    expect(h.getState()).toBe('idle');
    expect(h.elements.saveBtnLabel.textContent).toBe('Save');
    expect(h.goToLocationClass.ops).toEqual([]);
  });

  it('does not disturb a save that is still running', async () => {
    let openGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const h = makeHarness({
      saveImpl: async (_bytes, relPath) => { await gate; return `file:///data/${relPath}`; },
    });

    const running = h.save();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.getState()).toBe('saving');

    // Typing during the write must not re-enable the button mid-flight.
    h.resetSavedState();
    expect(h.getState()).toBe('saving');
    expect(h.elements.saveBtn.disabled).toBe(true);

    openGate!();
    await running;
    expect(h.getState()).toBe('saved');
  });

  it('lets the user save the same result again under a new name', async () => {
    const h = makeHarness();
    await h.save();

    h.elements.fileNameInput.value = 'report-v2';
    h.resetSavedState();
    await h.save();

    expect(h.writes.map((w) => w.path)).toEqual(['edits/report.pdf', 'edits/report-v2.pdf']);
    expect(h.recorded.map((r) => r.name)).toEqual(['report.pdf', 'report-v2.pdf']);
    expect(h.getState()).toBe('saved');
  });
});

describe('createSaveFlow — state guards', () => {
  it('ignores a click while a save is already in flight', async () => {
    const h = makeHarness();
    h.setState('saving');

    await h.save();

    expect(h.existsChecks).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.getState()).toBe('saving');
  });

  it('ignores a second click that lands before the first reaches "saving"', async () => {
    // The state variable only flips to 'saving' after `pathExists` — and maybe
    // a whole overwrite dialog — has been awaited. A tap landing inside that
    // window used to pass the guard and write a second time; the in-flight
    // flag is what closes it.
    let openGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    let firstCheck = true;
    const h = makeHarness({
      existsImpl: async () => {
        if (firstCheck) {
          firstCheck = false;
          await gate;
        }
        return false;
      },
    });

    const first = h.save();
    const second = h.save();
    openGate!();
    await Promise.all([first, second]);

    expect(h.writes.map((w) => w.path)).toEqual(['edits/report.pdf']);
    expect(h.recorded).toHaveLength(1);
    expect(h.getState()).toBe('saved');
  });

  it('ignores a second click that lands while the overwrite dialog is open', async () => {
    let openGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const h = makeHarness({
      exists: true,
      confirmImpl: async () => { await gate; return true; },
    });

    const first = h.save();
    await Promise.resolve();
    await Promise.resolve();
    const second = h.save();
    openGate!();
    await Promise.all([first, second]);

    // One dialog, one write — not two dialogs stacked on the same button.
    expect(h.confirms).toHaveLength(1);
    expect(h.writes.map((w) => w.path)).toEqual(['edits/report.pdf']);
  });

  it('leaves the button live after the user declines the overwrite', async () => {
    // The in-flight flag must not survive the cancel path, or the save button
    // is dead for the rest of the session.
    let answer = false;
    const h = makeHarness({ exists: true, confirmImpl: async () => answer });

    await h.save();
    expect(h.writes).toEqual([]);

    answer = true;
    await h.save();

    expect(h.confirms).toHaveLength(2);
    expect(h.writes.map((w) => w.path)).toEqual(['edits/report.pdf']);
    expect(h.getState()).toBe('saved');
  });

  it('leaves the button live after an invalid name and after a failed write', async () => {
    let mode: 'bad-name' | 'throw' | 'ok' = 'bad-name';
    const h = makeHarness({
      saveImpl: async (_bytes, relPath) => {
        if (mode === 'throw') throw new Error('disk full');
        return `file:///data/${relPath}`;
      },
    });

    h.elements.fileNameInput.value = '   ';
    await h.save();
    expect(h.toasts).toHaveLength(1);

    mode = 'throw';
    h.elements.fileNameInput.value = 'report';
    await h.save();
    expect(h.getState()).toBe('idle');

    mode = 'ok';
    await h.save();

    expect(h.getState()).toBe('saved');
    expect(h.recorded).toHaveLength(1);
  });

  it('ignores a click once the first has actually reached "saving"', async () => {
    let openGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const h = makeHarness({
      saveImpl: async (_bytes, relPath) => {
        await gate;
        return `file:///data/${relPath}`;
      },
    });

    const first = h.save();
    // Let the first run get past pathExists and into the 'saving' state.
    await Promise.resolve();
    await Promise.resolve();
    expect(h.getState()).toBe('saving');

    await h.save();
    openGate!();
    await first;

    expect(h.recorded).toHaveLength(1);
    expect(h.getState()).toBe('saved');
  });

  it('allows saving again after a completed save (only "saving" blocks)', async () => {
    const h = makeHarness();

    await h.save();
    expect(h.getState()).toBe('saved');

    h.elements.fileNameInput.value = 'second';
    await h.save();

    expect(h.writes.map((w) => w.path)).toEqual(['edits/report.pdf', 'edits/second.pdf']);
  });

  it('reads the result PDF at click time, not at wiring time', async () => {
    const h = makeHarness({ result: new Uint8Array([9]) });

    h.setResult(new Uint8Array([7, 7]));
    await h.save();

    expect(h.writes[0].bytes).toEqual(new Uint8Array([7, 7]));
  });

  it('writes the bytes that passed the guard even if the result is cleared mid-dialog', async () => {
    // The result holder is re-read at click time but captured for the write, so
    // clearing it while the overwrite dialog is open cannot turn the write into
    // a null-bytes write.
    let clearResult: (() => void) | null = null;
    const h = makeHarness({
      exists: true,
      result: new Uint8Array([5, 5]),
      onConfirm: () => clearResult?.(),
    });
    clearResult = () => h.setResult(null);

    await h.save();

    expect(h.writes).toEqual([{ path: 'edits/report.pdf', bytes: new Uint8Array([5, 5]) }]);
    expect(h.getState()).toBe('saved');
  });
});
