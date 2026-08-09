import { t } from '../i18n';
import { safeFileName } from './filename';

/**
 * The "save the result to private storage" flow shared by merge, organize,
 * rotate, page numbers and watermark.
 *
 * Those five handlers were byte-identical apart from three things: which
 * variable holds the result PDF, which folder it goes into, and which i18n key
 * names the success line. Every guard in between — filename sanitizing, the
 * overwrite confirm, the spinner/disabled/label state machine, `recordOpened`,
 * the error branch — is the same, and keeping five copies of it is how a guard
 * ends up present in one copy and missing from another.
 *
 * The booklet save flow is deliberately NOT built on this: it writes five files
 * into a per-document folder and runs a different state machine.
 */

export type SaveState = 'idle' | 'saving' | 'saved';

/** Private-storage folders a single-result tool may write into. */
export type SaveTargetDir = 'merges' | 'edits';

/** i18n key for the line shown after a successful save. */
export type SavedStatusKey =
  | 'status.merge.saved'
  | 'status.organize.saved'
  | 'status.rotate.saved'
  | 'status.pageNumbers.saved'
  | 'status.watermark.saved';

/** The slice of `DOMTokenList` this flow uses. */
interface ClassListLike {
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
}

/**
 * The DOM a save flow drives, described by the properties it actually touches
 * rather than by element type — real elements satisfy this structurally, and
 * tests can stand it up without a DOM.
 */
export interface SaveFlowElements {
  /** Read for the target name; rewritten to the sanitized base name on success. */
  fileNameInput: { value: string };
  saveBtn: { disabled: boolean };
  saveBtnLabel: { textContent: string | null; classList: ClassListLike };
  saveSpinner: { classList: ClassListLike };
  actionStatus: { textContent: string | null };
  goToLocationBtn: { classList: ClassListLike };
}

/** Side-effecting collaborators, injected so the flow runs off-device in tests. */
export interface SaveFlowDeps {
  pathExists(path: string): Promise<boolean>;
  savePdfPrivately(bytes: Uint8Array, relPath: string): Promise<string>;
  recordOpened(entry: { uri: string | null; name: string }): Promise<void>;
  showConfirmDialog(message: string): Promise<boolean>;
  showToast(message: string): void;
  errorText(error: unknown): string;
}

export interface SaveFlowOptions {
  /**
   * Read at click time, never captured at wiring time — the result changes
   * every time the user re-runs the tool.
   */
  getResultPdf(): Uint8Array | null;
  targetDir: SaveTargetDir;
  savedStatusKey: SavedStatusKey;
  /** The tool's own save-state variable, which other code still reads. */
  getState(): SaveState;
  setState(state: SaveState): void;
  elements: SaveFlowElements;
}

export interface SaveFlow {
  /** Click handler for the save button. Never throws: a failed write lands in `actionStatus`. */
  save(): Promise<void>;
  /**
   * 'input' handler for the file-name box. Editing the name after a save means
   * the button no longer refers to the file on disk, so it drops out of the
   * 'saved' presentation and becomes clickable again.
   */
  resetSavedState(): void;
}

/** Builds both handlers for one tool's save box from a single description of it. */
export function createSaveFlow(options: SaveFlowOptions, deps: SaveFlowDeps): SaveFlow {
  const el = options.elements;

  /**
   * Guards against a second click landing before the first has reached the
   * 'saving' state. `getState()` cannot do that job: it only flips after
   * `pathExists` — and possibly a whole overwrite dialog — has been awaited,
   * and a real tap easily lands inside that window.
   *
   * Cleared in a `finally` that wraps every exit path, so declining the
   * overwrite, an invalid name and a failed write all leave the button live.
   */
  let inFlight = false;

  async function runSave(resultPdf: Uint8Array): Promise<void> {
    const filename = safeFileName(el.fileNameInput.value, { ensurePdf: true });
    if (!filename) {
      deps.showToast(t('toast.invalidFileName'));
      return;
    }

    const targetPath = `${options.targetDir}/${filename}`;
    if (await deps.pathExists(targetPath)) {
      const overwrite = await deps.showConfirmDialog(
        t('common.overwriteConfirm', { name: filename }),
      );
      if (!overwrite) return;
    }

    options.setState('saving');
    el.saveBtn.disabled = true;
    el.saveBtnLabel.classList.add('hidden');
    el.saveSpinner.classList.remove('hidden');

    try {
      const savedUri = await deps.savePdfPrivately(resultPdf, targetPath);
      await deps.recordOpened({ uri: savedUri, name: filename });
      el.fileNameInput.value = filename.replace(/\.pdf$/i, '');
      el.actionStatus.textContent = t(options.savedStatusKey);
      options.setState('saved');
      el.saveBtnLabel.textContent = t('common.saved');
      el.goToLocationBtn.classList.remove('hidden');
    } catch (error) {
      const message = deps.errorText(error);
      el.actionStatus.textContent = t('status.saveFailed', { message });
      options.setState('idle');
      el.saveBtn.disabled = false;
    } finally {
      el.saveBtnLabel.classList.remove('hidden');
      el.saveSpinner.classList.add('hidden');
    }
  }

  return {
    async save(): Promise<void> {
      // Captured once so the bytes that get written are the bytes the guard
      // approved, even though a confirm dialog can await in between.
      const resultPdf = options.getResultPdf();
      if (!resultPdf || inFlight || options.getState() === 'saving') return;

      inFlight = true;
      try {
        await runSave(resultPdf);
      } finally {
        inFlight = false;
      }
    },

    resetSavedState(): void {
      if (options.getState() !== 'saved') return;
      options.setState('idle');
      el.saveBtn.disabled = false;
      el.saveBtnLabel.textContent = t('common.save');
      el.goToLocationBtn.classList.add('hidden');
    },
  };
}
