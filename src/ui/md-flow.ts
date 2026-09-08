import { TYPOGRAPHY_PRESETS, type TypographyPresetName } from '../engine/markdown-layout';
import { parseMarkdown } from '../engine/markdown-parse';
import { markdownToPdf } from '../engine/markdown-render';
import type { MdDocument } from '../engine/markdown-types';
import { BookletError } from '../engine/types';
import { t } from '../i18n';

export const MAX_MD_FILES = 50;
export const MAX_MD_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB

export interface SelectedMdFile {
  id: string;
  name: string;
  content: string;
  sizeBytes: number;
  lineCount: number;
}

export interface MdFlowCallbacks {
  showToast: (msg: string) => void;
  goToError: (title: string, msg: string, returnScreen?: string) => void;
  openReaderWithBytes: (bytes: Uint8Array, filename: string, uri: string, returnScreen: string) => Promise<void>;
  savePdfPrivately: (bytes: Uint8Array, relPath: string) => Promise<string>;
  rememberSaved: (uri: string, filename: string) => Promise<void>;
  onBookletGenerated: (bytes: Uint8Array, filename: string) => Promise<void>;
  formatError?: (err: unknown) => string;
}

export class MdFlowManager {
  private files: SelectedMdFile[] = [];
  private padDocumentsToEven = true;
  private typographyPreset: TypographyPresetName = 'standard';
  private nextId = 1;

  getFiles(): SelectedMdFile[] {
    return [...this.files];
  }

  getTotalBytes(): number {
    return this.files.reduce((sum, f) => sum + f.sizeBytes, 0);
  }

  getPadDocumentsToEven(): boolean {
    return this.padDocumentsToEven;
  }

  setPadDocumentsToEven(val: boolean): void {
    this.padDocumentsToEven = val;
  }

  getTypographyPreset(): TypographyPresetName {
    return this.typographyPreset;
  }

  setTypographyPreset(preset: TypographyPresetName): void {
    this.typographyPreset = preset;
  }

  addFile(name: string, content: string): SelectedMdFile {
    if (!/\.(md|markdown)$/i.test(name)) {
      throw new BookletError(
        'MARKDOWN_INVALID_EXTENSION',
        { name },
        `Only Markdown files (.md, .markdown) are supported: ${name}`,
      );
    }

    if (this.files.length >= MAX_MD_FILES) {
      throw new BookletError(
        'MARKDOWN_FILE_LIMIT',
        { max: String(MAX_MD_FILES) },
        `File limit exceeded (max ${MAX_MD_FILES})`,
      );
    }

    const sizeBytes = new TextEncoder().encode(content).length;
    if (this.getTotalBytes() + sizeBytes > MAX_MD_TOTAL_BYTES) {
      throw new BookletError(
        'MARKDOWN_TOTAL_SIZE_LIMIT',
        { limit: '25' },
        'Total size limit exceeded (max 25MB)',
      );
    }

    const normalized = content.replace(/\r?\n$/, '');
    const lineCount = normalized.length === 0 ? 0 : normalized.split(/\r?\n/).length;

    const file: SelectedMdFile = {
      id: `md-${this.nextId++}`,
      name,
      content,
      sizeBytes,
      lineCount,
    };
    this.files.push(file);
    return file;
  }

  removeFile(id: string): boolean {
    const idx = this.files.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    this.files.splice(idx, 1);
    return true;
  }

  moveFileUp(id: string): boolean {
    const idx = this.files.findIndex((f) => f.id === id);
    if (idx <= 0) return false;
    const item = this.files[idx];
    this.files[idx] = this.files[idx - 1];
    this.files[idx - 1] = item;
    return true;
  }

  moveFileDown(id: string): boolean {
    const idx = this.files.findIndex((f) => f.id === id);
    if (idx === -1 || idx >= this.files.length - 1) return false;
    const item = this.files[idx];
    this.files[idx] = this.files[idx + 1];
    this.files[idx + 1] = item;
    return true;
  }

  clear(): void {
    this.files = [];
    this.typographyPreset = 'standard';
  }

  toMdDocuments(): MdDocument[] {
    return this.files.map((f) => ({
      name: f.name.replace(/\.(md|markdown)$/i, ''),
      blocks: parseMarkdown(f.content),
    }));
  }

  async generatePdf(): Promise<Uint8Array> {
    if (this.files.length === 0) {
      throw new BookletError(
        'MARKDOWN_NO_CONTENT',
        undefined,
        'The selected Markdown files contain no printable content.',
      );
    }
    const docs = this.toMdDocuments();
    return await markdownToPdf(docs, {
      padDocumentsToEven: this.padDocumentsToEven,
      typography: TYPOGRAPHY_PRESETS[this.typographyPreset],
    });
  }
}

function formatErrorMessage(callbacks: MdFlowCallbacks, err: unknown): string {
  if (callbacks.formatError) {
    return callbacks.formatError(err);
  }
  if (err instanceof BookletError) {
    const key = `error.${err.code}`;
    const translated = t(key, err.params);
    return translated === key ? err.message : translated;
  }
  return err instanceof Error ? err.message : String(err);
}

export function initMdFlow(callbacks: MdFlowCallbacks): {
  manager: MdFlowManager;
  renderList: () => void;
  handleFiles: (files: FileList | File[]) => Promise<void>;
  reset: () => void;
} {
  const manager = new MdFlowManager();

  const fileInput = document.getElementById('mdFileInput') as HTMLInputElement | null;
  const clearBtn = document.getElementById('mdClearBtn') as HTMLButtonElement | null;
  const padEvenCheck = document.getElementById('mdPadEvenCheck') as HTMLInputElement | null;
  const typographyGroup = document.getElementById('mdTypographyGroup');
  const optionsPanel = document.getElementById('mdOptionsPanel');
  const emptyHint = document.getElementById('mdListEmptyHint');
  const fileList = document.getElementById('mdFileList');
  const actionsPanel = document.getElementById('mdActionsPanel');
  const bookletBtn = document.getElementById('mdGenerateBookletBtn') as HTMLButtonElement | null;
  const bookletLabel = document.getElementById('mdGenerateBookletLabel');
  const bookletSpinner = document.getElementById('mdGenerateBookletSpinner');
  const pdfBtn = document.getElementById('mdGeneratePdfBtn') as HTMLButtonElement | null;
  const pdfLabel = document.getElementById('mdGeneratePdfLabel');
  const pdfSpinner = document.getElementById('mdGeneratePdfSpinner');

  function updateTypographyUI(preset: TypographyPresetName): void {
    if (!typographyGroup) return;
    typographyGroup.querySelectorAll<HTMLButtonElement>('.segmented-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.typePreset === preset);
    });
  }

  if (typographyGroup) {
    typographyGroup.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
      if (!btn) return;
      const preset = btn.dataset.typePreset as TypographyPresetName | undefined;
      if (preset && preset in TYPOGRAPHY_PRESETS) {
        manager.setTypographyPreset(preset);
        updateTypographyUI(preset);
      }
    });
  }

  function renderList(): void {
    const files = manager.getFiles();
    const hasFiles = files.length > 0;

    if (emptyHint) emptyHint.classList.toggle('hidden', hasFiles);
    if (optionsPanel) optionsPanel.classList.toggle('hidden', !hasFiles);
    if (actionsPanel) actionsPanel.classList.toggle('hidden', !hasFiles);
    if (clearBtn) clearBtn.classList.toggle('hidden', !hasFiles);

    if (!fileList) return;
    fileList.innerHTML = '';

    files.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'merge-file-row';
      row.innerHTML = `
        <span class="merge-file-index">${index + 1}</span>
        <span class="merge-file-meta">
          <span class="merge-file-name"></span>
          <span class="merge-file-size"></span>
        </span>
        <span class="merge-file-actions">
          <button type="button" class="icon-btn-sm" data-action="up" aria-label="${t('common.moveUp')}">↑</button>
          <button type="button" class="icon-btn-sm" data-action="down" aria-label="${t('common.moveDown')}">↓</button>
          <button type="button" class="icon-btn-sm" data-action="remove" aria-label="${t('common.remove')}">✕</button>
        </span>
      `;

      row.querySelector('.merge-file-name')!.textContent = file.name;
      row.querySelector('.merge-file-size')!.textContent = t('mdToPdf.lines', { count: String(file.lineCount) });

      const upBtn = row.querySelector<HTMLButtonElement>('[data-action="up"]')!;
      const downBtn = row.querySelector<HTMLButtonElement>('[data-action="down"]')!;
      upBtn.disabled = index === 0;
      downBtn.disabled = index === files.length - 1;

      upBtn.addEventListener('click', () => {
        manager.moveFileUp(file.id);
        renderList();
      });

      downBtn.addEventListener('click', () => {
        manager.moveFileDown(file.id);
        renderList();
      });

      row.querySelector<HTMLButtonElement>('[data-action="remove"]')!.addEventListener('click', () => {
        manager.removeFile(file.id);
        renderList();
      });

      fileList.appendChild(row);
    });
  }

  async function handleFiles(files: FileList | File[]): Promise<void> {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const text = await file.text();
        manager.addFile(file.name, text);
      } catch (err) {
        if (err instanceof BookletError) {
          callbacks.showToast(formatErrorMessage(callbacks, err));
          if (err.code === 'MARKDOWN_FILE_LIMIT' || err.code === 'MARKDOWN_TOTAL_SIZE_LIMIT') {
            break;
          }
          continue;
        }
        callbacks.showToast(t('toast.mdFileReadError', { name: file.name }));
      }
    }
    renderList();
  }

  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      if (fileInput.files && fileInput.files.length > 0) {
        await handleFiles(fileInput.files);
        fileInput.value = '';
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      manager.clear();
      updateTypographyUI('standard');
      renderList();
    });
  }

  if (padEvenCheck) {
    padEvenCheck.addEventListener('change', () => {
      manager.setPadDocumentsToEven(padEvenCheck.checked);
    });
  }

  async function onGenerate(isBooklet: boolean): Promise<void> {
    // S1: Mutually lock both generation buttons
    if (bookletBtn) bookletBtn.disabled = true;
    if (pdfBtn) pdfBtn.disabled = true;

    const activeLabel = isBooklet ? bookletLabel : pdfLabel;
    const activeSpinner = isBooklet ? bookletSpinner : pdfSpinner;

    if (activeLabel) activeLabel.classList.add('hidden');
    if (activeSpinner) activeSpinner.classList.remove('hidden');

    try {
      const pdfBytes = await manager.generatePdf();
      const dateStr = new Date().toISOString().slice(0, 10);
      const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
      const filename = `Doc_${dateStr}_${timeStr}.pdf`;
      const relPath = `documents/${filename}`;
      const privateUri = await callbacks.savePdfPrivately(pdfBytes, relPath);
      await callbacks.rememberSaved(privateUri, filename);

      if (isBooklet) {
        await callbacks.onBookletGenerated(pdfBytes, filename);
      } else {
        await callbacks.openReaderWithBytes(pdfBytes, filename, privateUri, 'md-to-pdf');
      }
    } catch (err) {
      // B2: Proper localized error title and translated message via formatErrorMessage
      const message = formatErrorMessage(callbacks, err);
      callbacks.goToError(t('error.pdfCreateFailed'), message, 'md-to-pdf');
    } finally {
      if (bookletBtn) bookletBtn.disabled = false;
      if (pdfBtn) pdfBtn.disabled = false;
      if (activeLabel) activeLabel.classList.remove('hidden');
      if (activeSpinner) activeSpinner.classList.add('hidden');
    }
  }

  if (bookletBtn) {
    bookletBtn.addEventListener('click', () => void onGenerate(true));
  }

  if (pdfBtn) {
    pdfBtn.addEventListener('click', () => void onGenerate(false));
  }

  function reset(): void {
    manager.clear();
    if (fileInput) fileInput.value = '';
    updateTypographyUI('standard');
    renderList();
  }

  return { manager, renderList, handleFiles, reset };
}
