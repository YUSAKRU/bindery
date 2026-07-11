import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { BookletError } from '../engine/types';
import type { Binding, FlipEdge, PaperSize } from '../engine/types';
import { makeBooklet, computeSignatureMappings } from '../engine/booklet-engine';
import { mergePdfs } from '../engine/merge-engine';
import { organizePages } from '../engine/organize-engine';
import {
  addPageNumbers,
  formatPageLabel,
  type PageNumberFormat,
  type PageNumberPosition,
} from '../engine/page-numbers-engine';
import { rotatePages } from '../engine/rotate-engine';
import { downloadPdfFromUrl } from '../engine/download-engine';
import { validatePdf } from '../engine/validator';
import { addWatermark, type WatermarkOptions } from '../engine/watermark-engine';
import { imagesToPdf } from '../engine/image-to-pdf-engine';
import { warpPerspective, type Point } from '../engine/perspective-warp';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { App } from '@capacitor/app';
import { setupIncomingPdfLinks } from '../native/app-links';
import { pickPdfWithPersistentUri } from '../native/open-document';
import {
  pickImage,
  pickPdf,
  pickPdfs,
  readPdfFromUri,
  savePdfToDevice,
  savePdfPrivately,
  sharePdf,
  listPrivateFolder,
  createPrivateDirectory,
  deletePrivateItem,
  movePrivateItem,
  pathExists,
  FileTooLargeError,
  type PickedPdf,
  type FileEntryInfo,
} from '../native/file-bridge';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { destroyThumbnailDoc, loadPdfForThumbnails, renderPageThumbnail } from '../native/pdf-thumbnails';
import { openReaderDocument, renderReaderPage, type ReaderDocument } from '../native/pdf-reader-render';
import { getRecents, recordOpened, removeRecent, updateLastPage, type RecentEntry } from '../native/recents-store';
import { initLanguage, setLanguage, getLanguage, t, type Lang } from '../i18n';

type ScreenId =
  | 'hub'
  | 'picker'
  | 'config'
  | 'result'
  | 'error'
  | 'merge-picker'
  | 'merge-result'
  | 'organize'
  | 'organize-result'
  | 'rotate'
  | 'rotate-result'
  | 'page-numbers'
  | 'page-numbers-result'
  | 'watermark'
  | 'watermark-result'
  | 'image-to-pdf'
  | 'crop'
  | 'reader'
  | 'recents'
  | 'tools-all'
  | 'files'
  | 'settings';

const PARENT_SCREEN: Partial<Record<ScreenId, ScreenId>> = {
  picker: 'hub',
  config: 'picker',
  result: 'hub',
  'merge-picker': 'hub',
  'merge-result': 'hub',
  organize: 'hub',
  'organize-result': 'hub',
  rotate: 'hub',
  'rotate-result': 'hub',
  'page-numbers': 'hub',
  'page-numbers-result': 'hub',
  watermark: 'hub',
  'watermark-result': 'hub',
  'image-to-pdf': 'hub',
  crop: 'image-to-pdf',
  reader: 'hub',
  recents: 'hub',
  'tools-all': 'hub',
  files: 'hub',
  settings: 'hub',
};

const TOOL_ENTRY_SCREEN: Partial<Record<string, ScreenId>> = {
  booklet: 'picker',
  merge: 'merge-picker',
  organize: 'organize',
  rotate: 'rotate',
  'page-numbers': 'page-numbers',
  watermark: 'watermark',
  'image-to-pdf': 'image-to-pdf',
};

function byId<T extends Element = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as unknown as T;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Values are i18n keys, resolved via t() in showScreen().
const SCREEN_TITLES: Record<ScreenId, string> = {
  hub: 'screenTitle.brand',
  picker: 'screenTitle.picker',
  config: 'screenTitle.config',
  result: 'screenTitle.result',
  error: 'screenTitle.error',
  'merge-picker': 'screenTitle.mergePicker',
  'merge-result': 'screenTitle.mergeResult',
  organize: 'tool.organize.title',
  'organize-result': 'screenTitle.organizeResult',
  rotate: 'tool.rotate.title',
  'rotate-result': 'screenTitle.rotateResult',
  'page-numbers': 'tool.pageNumbers.title',
  'page-numbers-result': 'screenTitle.pageNumbersResult',
  watermark: 'tool.watermark.title',
  'watermark-result': 'screenTitle.watermarkResult',
  'image-to-pdf': 'tool.imageToPdf.title',
  crop: 'screenTitle.crop',
  reader: 'screenTitle.brand',
  recents: 'hub.recentlyOpened',
  'tools-all': 'tools.allTitle',
  files: 'screenTitle.files',
  settings: 'settings.title',
};

export function initApp(): void {
  initLanguage();

  const topBarTitle = byId<HTMLHeadingElement>('topBarTitle');
  const backBtn = byId<HTMLButtonElement>('backBtn');
  const savePdfBtn = byId<HTMLButtonElement>('savePdfBtn');
  const sharePdfBtn = byId<HTMLButtonElement>('sharePdfBtn');

  const saveDocModal = byId<HTMLDivElement>('saveDocModal');
  const saveDocNameInput = byId<HTMLInputElement>('saveDocNameInput');
  const saveDocCancelBtn = byId<HTMLButtonElement>('saveDocCancelBtn');
  const saveDocConfirmBtn = byId<HTMLButtonElement>('saveDocConfirmBtn');
  const saveDocConfirmBtnLabel = byId<HTMLSpanElement>('saveDocConfirmBtnLabel');
  const saveDocConfirmSpinner = byId<HTMLSpanElement>('saveDocConfirmSpinner');

  const screens: Record<ScreenId, HTMLElement> = {
    hub: byId('screen-hub'),
    picker: byId('screen-picker'),
    config: byId('screen-config'),
    result: byId('screen-result'),
    error: byId('screen-error'),
    'merge-picker': byId('screen-merge-picker'),
    'merge-result': byId('screen-merge-result'),
    organize: byId('screen-organize'),
    'organize-result': byId('screen-organize-result'),
    rotate: byId('screen-rotate'),
    'rotate-result': byId('screen-rotate-result'),
    'page-numbers': byId('screen-page-numbers'),
    'page-numbers-result': byId('screen-page-numbers-result'),
    watermark: byId('screen-watermark'),
    'watermark-result': byId('screen-watermark-result'),
    'image-to-pdf': byId('screen-image-to-pdf'),
    crop: byId('screen-crop'),
    reader: byId('screen-reader'),
    recents: byId('screen-recents'),
    'tools-all': byId('screen-tools-all'),
    files: byId('screen-files'),
    settings: byId('screen-settings'),
  };

  const recentsListLarge = byId<HTMLElement>('recentsListLarge');
  const recentsEmptyHint = byId<HTMLElement>('recentsEmptyHint');
  const filesList = byId<HTMLElement>('filesList');
  const filesEmptyHint = byId<HTMLElement>('filesEmptyHint');
  const filesBreadcrumb = byId<HTMLElement>('filesBreadcrumb');
  const filesNewFolderBtn = byId<HTMLButtonElement>('filesNewFolderBtn');
  const filesDownloadBtn = byId<HTMLButtonElement>('filesDownloadBtn');
  const filesSortBtn = byId<HTMLButtonElement>('filesSortBtn');
  const filesSearchInput = byId<HTMLInputElement>('filesSearchInput');
  const filesSortSheet = byId<HTMLDivElement>('filesSortSheet');
  const filesSortBackdrop = byId<HTMLDivElement>('filesSortBackdrop');
  const filesSortRows = Array.from(filesSortSheet.querySelectorAll<HTMLButtonElement>('.tool-row[data-sort]'));
  const downloadPdfModal = byId<HTMLDivElement>('downloadPdfModal');
  const downloadPdfUrlInput = byId<HTMLInputElement>('downloadPdfUrlInput');
  const downloadPdfNameInput = byId<HTMLInputElement>('downloadPdfNameInput');
  const downloadPdfCancelBtn = byId<HTMLButtonElement>('downloadPdfCancelBtn');
  const downloadPdfConfirmBtn = byId<HTMLButtonElement>('downloadPdfConfirmBtn');
  const downloadPdfConfirmBtnLabel = byId<HTMLSpanElement>('downloadPdfConfirmBtnLabel');
  const downloadPdfSpinner = byId<HTMLSpanElement>('downloadPdfSpinner');
  const pdfSourceModal = byId<HTMLDivElement>('pdfSourceModal');
  const pdfSourceBinderyBtn = byId<HTMLButtonElement>('pdfSourceBinderyBtn');
  const pdfSourceDeviceBtn = byId<HTMLButtonElement>('pdfSourceDeviceBtn');
  const pdfSourceCancelBtn = byId<HTMLButtonElement>('pdfSourceCancelBtn');

  const binderyFilePickerModal = byId<HTMLDivElement>('binderyFilePickerModal');
  const binderyPickerBreadcrumb = byId<HTMLDivElement>('binderyPickerBreadcrumb');
  const binderyPickerList = byId<HTMLDivElement>('binderyPickerList');
  const binderyPickerEmptyHint = byId<HTMLParagraphElement>('binderyPickerEmptyHint');
  const binderyPickerCancelBtn = byId<HTMLButtonElement>('binderyPickerCancelBtn');
  const binderyPickerConfirmBtn = byId<HTMLButtonElement>('binderyPickerConfirmBtn');
  const moveDocModal = byId<HTMLDivElement>('moveDocModal');
  const moveDocFolderList = byId<HTMLDivElement>('moveDocFolderList');
  const moveDocCancelBtn = byId<HTMLButtonElement>('moveDocCancelBtn');
  const moveDocConfirmBtn = byId<HTMLButtonElement>('moveDocConfirmBtn');
  const fileActionsModal = byId<HTMLDivElement>('fileActionsModal');
  const fileActionsTitle = byId<HTMLElement>('fileActionsTitle');
  const fileActionsList = byId<HTMLDivElement>('fileActionsList');
  const fileActionsCancelBtn = byId<HTMLButtonElement>('fileActionsCancelBtn');
  const openInToolSheet = byId<HTMLDivElement>('openInToolSheet');
  const openInToolList = byId<HTMLDivElement>('openInToolList');
  const openInToolCancelBtn = byId<HTMLButtonElement>('openInToolCancelBtn');
  const settingsDarkModeToggle = byId<HTMLInputElement>('settingsDarkModeToggle');
  const settingsClearCacheBtn = byId<HTMLButtonElement>('settingsClearCacheBtn');
  const appVersionValue = byId<HTMLSpanElement>('appVersionValue');
  const settingsLangBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.settings-lang-btn'),
  );
  const onboardingOverlay = byId<HTMLDivElement>('onboardingOverlay');
  const onboardingTrack = byId<HTMLDivElement>('onboardingTrack');
  const onboardingDots = byId<HTMLDivElement>('onboardingDots');
  const onboardingNextBtn = byId<HTMLButtonElement>('onboardingNextBtn');
  const onboardingThemeBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.onboarding-theme-btn'),
  );
  const onboardingLangBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.onboarding-lang-btn'),
  );

  // Files explorer state
  type FileSortMode = 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc';
  let filesSortMode: FileSortMode = (localStorage.getItem('bindery.filesSort') as FileSortMode) ?? 'date-desc';
  let currentFolderPath = '';
  let moveSourceFile: FileEntryInfo | null = null;
  let moveTargetFolder: string | null = null;
  let openInToolUri: string | null = null;

  function sortFileEntries(items: FileEntryInfo[], mode: FileSortMode): FileEntryInfo[] {
    const dirs = items.filter((i) => i.type === 'directory');
    const files = items.filter((i) => i.type === 'file');
    const cmp = (a: FileEntryInfo, b: FileEntryInfo): number => {
      switch (mode) {
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'date-asc': return a.lastModified - b.lastModified;
        case 'date-desc': return b.lastModified - a.lastModified;
      }
    };
    return [...dirs.sort(cmp), ...files.sort(cmp)];
  }

  const bottomNav = byId<HTMLElement>('bottomNav');
  const hubSearchInput = byId<HTMLInputElement>('hubSearchInput');
  const toast = byId<HTMLDivElement>('toast');
  // Only the hub carousel and All-Tools rows use this navigate-or-"coming soon"
  // handler. The reader tools sheet and the files sort sheet reuse the .tool-row
  // styling but have their own dedicated click handlers, so exclude them here —
  // otherwise their rows also fire a spurious "coming soon" toast.
  const toolRows = Array.from(document.querySelectorAll<HTMLButtonElement>('.tool-row')).filter(
    (row) => !row.closest('#readerToolsSheet') && !row.closest('#filesSortSheet'),
  );
  const carouselToolRows = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.hub-carousel .tool-row'),
  );

  const pickFileBtn = byId<HTMLButtonElement>('pickFileBtn');
  const fileCard = byId<HTMLDivElement>('fileCard');
  const fileNameLabel = byId<HTMLSpanElement>('fileNameLabel');
  const fileSizeLabel = byId<HTMLSpanElement>('fileSizeLabel');
  const clearFileBtn = byId<HTMLButtonElement>('clearFileBtn');
  const continueBtn = byId<HTMLButtonElement>('continueBtn');

  const gutterSlider = byId<HTMLInputElement>('gutterSlider');
  const gutterValueLabel = byId<HTMLSpanElement>('gutterValueLabel');
  const creepSlider = byId<HTMLInputElement>('creepSlider');
  const creepValueLabel = byId<HTMLSpanElement>('creepValueLabel');
  const paperSizeGroup = byId<HTMLDivElement>('paperSizeGroup');
  const flipEdgeGroup = byId<HTMLDivElement>('flipEdgeGroup');
  const signatureSizeGroup = byId<HTMLDivElement>('signatureSizeGroup');
  const bindingGroup = byId<HTMLDivElement>('bindingGroup');
  const coverModeGroup = byId<HTMLDivElement>('coverModeGroup');
  const instructionsGroup = byId<HTMLDivElement>('instructionsGroup');
  const coverHintText = byId<HTMLParagraphElement>('coverHintText');
  const insertBlankInput = byId<HTMLInputElement>('insertBlankInput');
  const insertBlankError = byId<HTMLParagraphElement>('insertBlankError');
  const configSummary = byId<HTMLDivElement>('configSummary');
  const advancedToggle = byId<HTMLButtonElement>('advancedToggle');
  const advancedPanel = byId<HTMLDivElement>('advancedPanel');
  const advancedBadge = byId<HTMLSpanElement>('advancedBadge');
  const mixedSizeWarning = byId<HTMLDivElement>('mixedSizeWarning');
  const generateBtn = byId<HTMLButtonElement>('generateBtn');
  const generateBtnLabel = byId<HTMLSpanElement>('generateBtnLabel');
  const generateSpinner = byId<HTMLSpanElement>('generateSpinner');

  const statOriginal = byId<HTMLSpanElement>('statOriginal');
  const statPaddingCard = byId<HTMLDivElement>('statPaddingCard');
  const statPadding = byId<HTMLSpanElement>('statPadding');
  const statSheets = byId<HTMLSpanElement>('statSheets');
  const statSignaturesCard = byId<HTMLDivElement>('statSignaturesCard');
  const statSignatures = byId<HTMLSpanElement>('statSignatures');
  const statBlanksCard = byId<HTMLDivElement>('statBlanksCard');
  const statBlanks = byId<HTMLSpanElement>('statBlanks');
  const coverActionRow = byId<HTMLDivElement>('coverActionRow');
  const instructionsActionRow = byId<HTMLDivElement>('instructionsActionRow');
  const actionStatus = byId<HTMLParagraphElement>('actionStatus');
  const newFileBtn = byId<HTMLButtonElement>('newFileBtn');
  const readerOpeningOverlay = byId<HTMLDivElement>('readerOpeningOverlay');
  const frontPreviewImg = byId<HTMLImageElement>('frontPreviewImg');
  const frontPreviewSpinner = byId<HTMLDivElement>('frontPreviewSpinner');
  const frontPreviewError = byId<HTMLParagraphElement>('frontPreviewError');
  const backPreviewImg = byId<HTMLImageElement>('backPreviewImg');
  const backPreviewSpinner = byId<HTMLDivElement>('backPreviewSpinner');
  const backPreviewError = byId<HTMLParagraphElement>('backPreviewError');
  const coverPreviewCell = byId<HTMLDivElement>('coverPreviewCell');
  const coverPreviewImg = byId<HTMLImageElement>('coverPreviewImg');
  const coverPreviewSpinner = byId<HTMLDivElement>('coverPreviewSpinner');
  const coverPreviewError = byId<HTMLParagraphElement>('coverPreviewError');
  const bookletFileNameInput = byId<HTMLInputElement>('bookletFileNameInput');
  const bookletSaveBtn = byId<HTMLButtonElement>('bookletSaveBtn');
  const bookletSaveBtnLabel = byId<HTMLSpanElement>('bookletSaveBtnLabel');
  const bookletSaveSpinner = byId<HTMLSpanElement>('bookletSaveSpinner');
  const bookletGoToLocationBtn = byId<HTMLButtonElement>('bookletGoToLocationBtn');

  const errorTitle = byId<HTMLHeadingElement>('errorTitle');
  const errorMessage = byId<HTMLParagraphElement>('errorMessage');
  const retryBtn = byId<HTMLButtonElement>('retryBtn');

  const mergeAddFileBtn = byId<HTMLButtonElement>('mergeAddFileBtn');
  const mergeEmptyHint = byId<HTMLParagraphElement>('mergeEmptyHint');
  const mergeFileList = byId<HTMLDivElement>('mergeFileList');
  const mergeRunBtn = byId<HTMLButtonElement>('mergeRunBtn');
  const mergeRunBtnLabel = byId<HTMLSpanElement>('mergeRunBtnLabel');
  const mergeRunSpinner = byId<HTMLSpanElement>('mergeRunSpinner');
  const mergeStatFiles = byId<HTMLSpanElement>('mergeStatFiles');
  const mergeStatPages = byId<HTMLSpanElement>('mergeStatPages');
  const mergeFileNameInput = byId<HTMLInputElement>('mergeFileNameInput');
  const mergeSaveBtn = byId<HTMLButtonElement>('mergeSaveBtn');
  const mergeSaveBtnLabel = byId<HTMLSpanElement>('mergeSaveBtnLabel');
  const mergeSaveSpinner = byId<HTMLSpanElement>('mergeSaveSpinner');
  const mergeShareBtn = byId<HTMLButtonElement>('mergeShareBtn');
  const mergeActionStatus = byId<HTMLParagraphElement>('mergeActionStatus');
  const mergeGoToLocationBtn = byId<HTMLButtonElement>('mergeGoToLocationBtn');
  const mergeNewBtn = byId<HTMLButtonElement>('mergeNewBtn');

  let selectedFile: { name: string; bytes: Uint8Array } | null = null;
  let booklet: {
    frontPdf: Uint8Array;
    backPdf: Uint8Array;
    combinedPdf: Uint8Array;
    coverPdf?: Uint8Array;
    instructionsPdf?: Uint8Array;
  } | null = null;
  let bookletSaveState: 'idle' | 'saving' | 'saved' = 'idle';
  let bookletFlipEdge: FlipEdge = 'short';
  let bookletPaperSize: PaperSize = 'A4';
  // Hub hero brand-moment intro: assigned by the controller block below;
  // showScreen('hub') and finishOnboarding() call it. No-op until set.
  let requestHeroIntro: () => void = () => {};
  // Raw segmented value: 'single' | '8' | '16' | '32' | 'auto'.
  let bookletSignature = 'single';
  let bookletBinding: Binding = 'ltr';
  let bookletSeparateCover = false;
  let bookletIncludeInstructions = false;
  // Original page count of the selected source (0 = none). Drives the live
  // config summary and the separate-cover availability check.
  let bookletOriginalPages = 0;
  let returnScreenOnError: ScreenId = 'picker';

  let mergeFiles: PickedPdf[] = [];
  let mergedPdf: Uint8Array | null = null;
  let mergeSaveState: 'idle' | 'saving' | 'saved' = 'idle';

  function generateDefaultMergeName(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `Merged_${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  const organizeHero = byId<HTMLDivElement>('organizeHero');
  const organizePickBtn = byId<HTMLButtonElement>('organizePickBtn');
  const organizePageList = byId<HTMLDivElement>('organizePageList');
  const organizeApplyBtn = byId<HTMLButtonElement>('organizeApplyBtn');
  const organizeApplyBtnLabel = byId<HTMLSpanElement>('organizeApplyBtnLabel');
  const organizeApplySpinner = byId<HTMLSpanElement>('organizeApplySpinner');
  const organizeStatOriginal = byId<HTMLSpanElement>('organizeStatOriginal');
  const organizeStatRemaining = byId<HTMLSpanElement>('organizeStatRemaining');
  const organizeFileNameInput = byId<HTMLInputElement>('organizeFileNameInput');
  const organizeSaveBtn = byId<HTMLButtonElement>('organizeSaveBtn');
  const organizeSaveBtnLabel = byId<HTMLSpanElement>('organizeSaveBtnLabel');
  const organizeSaveSpinner = byId<HTMLSpanElement>('organizeSaveSpinner');
  const organizeShareBtn = byId<HTMLButtonElement>('organizeShareBtn');
  const organizeActionStatus = byId<HTMLParagraphElement>('organizeActionStatus');
  const organizeGoToLocationBtn = byId<HTMLButtonElement>('organizeGoToLocationBtn');
  const organizeNewBtn = byId<HTMLButtonElement>('organizeNewBtn');

  let organizeOriginalBytes: Uint8Array | null = null;
  let organizeOriginalName = 'document';
  let organizePdfDoc: PDFDocumentProxy | null = null;
  let organizePageOrder: number[] = [];
  const organizeThumbCache = new Map<number, string>();
  let organizeResultPdf: Uint8Array | null = null;
  let organizeThumbObserver: IntersectionObserver | null = null;
  let organizeSaveState: 'idle' | 'saving' | 'saved' = 'idle';

  const rotateHero = byId<HTMLDivElement>('rotateHero');
  const rotatePickBtn = byId<HTMLButtonElement>('rotatePickBtn');
  const rotateAllBtn = byId<HTMLButtonElement>('rotateAllBtn');
  const rotatePageList = byId<HTMLDivElement>('rotatePageList');
  const rotateApplyBtn = byId<HTMLButtonElement>('rotateApplyBtn');
  const rotateApplyBtnLabel = byId<HTMLSpanElement>('rotateApplyBtnLabel');
  const rotateApplySpinner = byId<HTMLSpanElement>('rotateApplySpinner');
  const rotateStatPages = byId<HTMLSpanElement>('rotateStatPages');
  const rotateFileNameInput = byId<HTMLInputElement>('rotateFileNameInput');
  const rotateSaveBtn = byId<HTMLButtonElement>('rotateSaveBtn');
  const rotateSaveBtnLabel = byId<HTMLSpanElement>('rotateSaveBtnLabel');
  const rotateSaveSpinner = byId<HTMLSpanElement>('rotateSaveSpinner');
  const rotateShareBtn = byId<HTMLButtonElement>('rotateShareBtn');
  const rotateActionStatus = byId<HTMLParagraphElement>('rotateActionStatus');
  const rotateGoToLocationBtn = byId<HTMLButtonElement>('rotateGoToLocationBtn');
  const rotateNewBtn = byId<HTMLButtonElement>('rotateNewBtn');

  let rotateOriginalBytes: Uint8Array | null = null;
  let rotateOriginalName = 'document';
  let rotatePdfDoc: PDFDocumentProxy | null = null;
  let rotateAngles: number[] = [];
  const rotateThumbCache = new Map<number, string>();
  let rotateResultPdf: Uint8Array | null = null;
  let rotateThumbObserver: IntersectionObserver | null = null;
  let rotateSaveState: 'idle' | 'saving' | 'saved' = 'idle';

  const pageNumbersHero = byId<HTMLDivElement>('pageNumbersHero');
  const pageNumbersPickBtn = byId<HTMLButtonElement>('pageNumbersPickBtn');
  const pageNumbersPreviewCard = byId<HTMLDivElement>('pageNumbersPreviewCard');
  const pageNumbersPreviewImg = byId<HTMLImageElement>('pageNumbersPreviewImg');
  const pageNumbersOverlay = byId<HTMLSpanElement>('pageNumbersOverlay');
  const pageNumbersSettingsPanel = byId<HTMLDivElement>('pageNumbersSettingsPanel');
  const pageNumbersPositionGroup = byId<HTMLDivElement>('pageNumbersPositionGroup');
  const pageNumbersFormatGroup = byId<HTMLDivElement>('pageNumbersFormatGroup');
  const pageNumbersStartInput = byId<HTMLInputElement>('pageNumbersStartInput');
  const pageNumbersApplyBtn = byId<HTMLButtonElement>('pageNumbersApplyBtn');
  const pageNumbersApplyBtnLabel = byId<HTMLSpanElement>('pageNumbersApplyBtnLabel');
  const pageNumbersApplySpinner = byId<HTMLSpanElement>('pageNumbersApplySpinner');
  const pageNumbersStatPages = byId<HTMLSpanElement>('pageNumbersStatPages');
  const pageNumbersFileNameInput = byId<HTMLInputElement>('pageNumbersFileNameInput');
  const pageNumbersSaveBtn = byId<HTMLButtonElement>('pageNumbersSaveBtn');
  const pageNumbersSaveBtnLabel = byId<HTMLSpanElement>('pageNumbersSaveBtnLabel');
  const pageNumbersSaveSpinner = byId<HTMLSpanElement>('pageNumbersSaveSpinner');
  const pageNumbersShareBtn = byId<HTMLButtonElement>('pageNumbersShareBtn');
  const pageNumbersActionStatus = byId<HTMLParagraphElement>('pageNumbersActionStatus');
  const pageNumbersGoToLocationBtn = byId<HTMLButtonElement>('pageNumbersGoToLocationBtn');
  const pageNumbersNewBtn = byId<HTMLButtonElement>('pageNumbersNewBtn');

  let pageNumbersOriginalBytes: Uint8Array | null = null;
  let pageNumbersOriginalName = 'document';
  let pageNumbersPdfDoc: PDFDocumentProxy | null = null;
  let pageNumbersOptions: { position: PageNumberPosition; format: PageNumberFormat; startNumber: number } = {
    position: 'bottom-right',
    format: 'number',
    startNumber: 1,
  };
  let pageNumbersResultPdf: Uint8Array | null = null;
  let pageNumbersSaveState: 'idle' | 'saving' | 'saved' = 'idle';

  const watermarkHero = byId<HTMLDivElement>('watermarkHero');
  const watermarkPickBtn = byId<HTMLButtonElement>('watermarkPickBtn');
  const watermarkPreviewCard = byId<HTMLDivElement>('watermarkPreviewCard');
  const watermarkPreviewImg = byId<HTMLImageElement>('watermarkPreviewImg');
  const watermarkOverlayText = byId<HTMLSpanElement>('watermarkOverlayText');
  const watermarkOverlayImage = byId<HTMLImageElement>('watermarkOverlayImage');
  const watermarkSettingsPanel = byId<HTMLDivElement>('watermarkSettingsPanel');
  const watermarkModeGroup = byId<HTMLDivElement>('watermarkModeGroup');
  const watermarkTextCard = byId<HTMLDivElement>('watermarkTextCard');
  const watermarkTextInput = byId<HTMLInputElement>('watermarkTextInput');
  const watermarkImageCard = byId<HTMLDivElement>('watermarkImageCard');
  const watermarkImagePickBtn = byId<HTMLButtonElement>('watermarkImagePickBtn');
  const watermarkImageStatus = byId<HTMLParagraphElement>('watermarkImageStatus');
  const watermarkRotateGroup = byId<HTMLDivElement>('watermarkRotateGroup');
  const watermarkOpacitySlider = byId<HTMLInputElement>('watermarkOpacitySlider');
  const watermarkOpacityLabel = byId<HTMLSpanElement>('watermarkOpacityLabel');
  const watermarkScaleCard = byId<HTMLDivElement>('watermarkScaleCard');
  const watermarkScaleSlider = byId<HTMLInputElement>('watermarkScaleSlider');
  const watermarkScaleLabel = byId<HTMLSpanElement>('watermarkScaleLabel');
  const watermarkApplyBtn = byId<HTMLButtonElement>('watermarkApplyBtn');
  const watermarkApplyBtnLabel = byId<HTMLSpanElement>('watermarkApplyBtnLabel');
  const watermarkApplySpinner = byId<HTMLSpanElement>('watermarkApplySpinner');
  const watermarkStatPages = byId<HTMLSpanElement>('watermarkStatPages');
  const watermarkFileNameInput = byId<HTMLInputElement>('watermarkFileNameInput');
  const watermarkSaveBtn = byId<HTMLButtonElement>('watermarkSaveBtn');
  const watermarkSaveBtnLabel = byId<HTMLSpanElement>('watermarkSaveBtnLabel');
  const watermarkSaveSpinner = byId<HTMLSpanElement>('watermarkSaveSpinner');
  const watermarkShareBtn = byId<HTMLButtonElement>('watermarkShareBtn');
  const watermarkActionStatus = byId<HTMLParagraphElement>('watermarkActionStatus');
  const watermarkGoToLocationBtn = byId<HTMLButtonElement>('watermarkGoToLocationBtn');
  const watermarkNewBtn = byId<HTMLButtonElement>('watermarkNewBtn');

  let watermarkOriginalBytes: Uint8Array | null = null;
  let watermarkOriginalName = 'document';
  let watermarkMode: 'text' | 'image' = 'text';
  let watermarkImageBytes: Uint8Array | null = null;
  let watermarkImageFormat: 'png' | 'jpg' = 'png';
  let watermarkRotateDegrees = 45;
  let watermarkResultPdf: Uint8Array | null = null;
  let watermarkSaveState: 'idle' | 'saving' | 'saved' = 'idle';

  const hubOpenReaderBtn = byId<HTMLButtonElement>('hubOpenReaderBtn');
  const recentsList = byId<HTMLDivElement>('recentsList');
  const recentsViewAllBtn = byId<HTMLButtonElement>('recentsViewAllBtn');
  const toolsViewAllBtn = byId<HTMLButtonElement>('toolsViewAllBtn');
  const readerPageIndicator = byId<HTMLButtonElement>('readerPageIndicator');
  const readerNightModeBtn = byId<HTMLButtonElement>('readerNightModeBtn');
  const readerScrubber = byId<HTMLDivElement>('readerScrubber');
  const readerScrubberThumb = byId<HTMLDivElement>('readerScrubberThumb');
  const readerScrubberBubble = byId<HTMLDivElement>('readerScrubberBubble');
  const goToPageModal = byId<HTMLDivElement>('goToPageModal');
  const goToPageInput = byId<HTMLInputElement>('goToPageInput');
  const goToPageCancelBtn = byId<HTMLButtonElement>('goToPageCancelBtn');
  const goToPageConfirmBtn = byId<HTMLButtonElement>('goToPageConfirmBtn');
  const appShell = byId<HTMLDivElement>('appRoot');
  const readerFullscreenBtn = byId<HTMLButtonElement>('readerFullscreenBtn');
  const readerFullscreenOverlay = byId<HTMLDivElement>('readerFullscreenOverlay');
  const fsOverlayBar = byId<HTMLDivElement>('fsOverlayBar');
  const fsExitBtn = byId<HTMLButtonElement>('fsExitBtn');
  const fsPageIndicator = byId<HTMLSpanElement>('fsPageIndicator');
  const fsRotateLeftBtn = byId<HTMLButtonElement>('fsRotateLeftBtn');
  const fsRotateRightBtn = byId<HTMLButtonElement>('fsRotateRightBtn');
  const fsViewer = byId<HTMLDivElement>('fsViewer');
  const readerToolsBtn = byId<HTMLButtonElement>('readerToolsBtn');
  const readerScroll = byId<HTMLDivElement>('readerScroll');
  const readerPageList = byId<HTMLDivElement>('readerPageList');
  const readerToolsSheet = byId<HTMLDivElement>('readerToolsSheet');
  const readerToolsBackdrop = byId<HTMLDivElement>('readerToolsBackdrop');
  const readerToolRows = Array.from(
    readerToolsSheet.querySelectorAll<HTMLButtonElement>('.tool-row'),
  );
  const readerNavBtn = byId<HTMLButtonElement>('readerNavBtn');
  const readerNavSheet = byId<HTMLDivElement>('readerNavSheet');
  const readerNavBackdrop = byId<HTMLDivElement>('readerNavBackdrop');
  const readerNavTabButtons = Array.from(
    byId<HTMLDivElement>('readerNavTabs').querySelectorAll<HTMLButtonElement>('.reader-nav-tab'),
  );
  const readerNavOutlineTab = byId<HTMLButtonElement>('readerNavOutlineTab');
  const readerNavBody = byId<HTMLDivElement>('readerNavBody');
  const readerNavPagesPane = byId<HTMLDivElement>('readerNavPagesPane');
  const readerNavOutlinePane = byId<HTMLDivElement>('readerNavOutlinePane');
  const readerNavRecentsPane = byId<HTMLDivElement>('readerNavRecentsPane');
  const readerNavGrid = byId<HTMLDivElement>('readerNavGrid');
  const readerNavOutlineList = byId<HTMLDivElement>('readerNavOutlineList');
  const readerNavRecentsList = byId<HTMLDivElement>('readerNavRecentsList');

  // Search panel elements
  const readerSearchBtn = byId<HTMLButtonElement>('readerSearchBtn');
  const readerSearchPanel = byId<HTMLDivElement>('readerSearchPanel');
  const readerSearchInput = byId<HTMLInputElement>('readerSearchInput');
  const readerSearchCount = byId<HTMLSpanElement>('readerSearchCount');
  const readerSearchPrevBtn = byId<HTMLButtonElement>('readerSearchPrevBtn');
  const readerSearchNextBtn = byId<HTMLButtonElement>('readerSearchNextBtn');
  const readerSearchCloseBtn = byId<HTMLButtonElement>('readerSearchCloseBtn');

  let readerDoc: ReaderDocument | null = null;
  let readerBytes: Uint8Array | null = null;
  let readerUri: string | null = null;
  let readerName = 'Document';
  let isFullscreenReaderActive = false;
  let readerReturnTo: ScreenId = 'hub';
  let fsRotationAngle = 0; // 0, 90, 180, 270 / -90
  let isFullscreenAutoOpened = false;
  let fsNativeOrientationHandler: (() => void) | null = null;
  let fullscreenCurrentPage = 1;
  let readerObserver: IntersectionObserver | null = null;
  const readerRendered = new Map<number, HTMLCanvasElement>();
  let readerNightMode = false;
  let readerBaseWidthPx = 0;
  let readerIndicatorRaf = 0;
  let readerLastPageSaveTimer: ReturnType<typeof setTimeout> | undefined;
  // Must match .reader-page-list's `gap` and top padding in styles.css.
  const READER_PAGE_GAP_PX = 6;
  const READER_LIST_TOP_PADDING_PX = 6;
  // Per-page layout metadata, rebuilt on every document open (renderReaderList).
  // Pages can have mixed orientations, so slot math is per-page, not uniform:
  // readerPageOffsets[i] is the distance from the top of the page list to
  // page i+1's top edge (gaps included), before the list's own top offset.
  let readerPageHeights: number[] = [];
  let readerPageOffsets: number[] = [];
  // Aspect ratios (h/w) from the open-time size scan; heights/offsets are
  // derived from these on every relayout without touching the PDF again.
  let readerPageAspects: number[] = [];
  // Distance from scrollTop=0 to the first page's top edge (the scroll
  // container's own padding plus the list's top padding), measured after
  // layout in renderReaderList.
  let readerListTopOffsetPx = READER_LIST_TOP_PADDING_PX;
  // Zoom factor (1..3) on top of readerBaseWidthPx; the effective layout
  // width actually applied to the DOM is tracked separately so focal-point
  // math during a zoom change can still see the outgoing width.
  let readerZoom = 1;
  let readerLayoutWidthPx = 0;
  const READER_ZOOM_MIN = 1;
  const READER_ZOOM_MAX = 3;

  /** Current page for a given readerScroll.scrollTop (binary search over offsets). */
  function readerPageAtScrollTop(scrollTop: number): number {
    if (readerPageOffsets.length === 0) return 1;
    // At the hard bottom the last page's top may never reach scrollTop (it can
    // be shorter than the viewport), so top-anchored search would undercount.
    const maxScroll = readerScroll.scrollHeight - readerScroll.clientHeight;
    if (maxScroll > 0 && scrollTop >= maxScroll - 2) return readerPageOffsets.length;
    // +0.75px bias: fractional scrollTop restores land a hair short of exact
    // page-top boundaries and must not flip the result to the previous page.
    const offset = Math.max(0, scrollTop - readerListTopOffsetPx) + 0.75;
    let lo = 0;
    let hi = readerPageOffsets.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (readerPageOffsets[mid] <= offset) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans + 1;
  }

  /** scrollTop that puts the given 1-based page's top at the top of the viewport. */
  function readerScrollTopForPage(pageNumber: number): number {
    if (readerPageOffsets.length === 0) return 0;
    const idx = Math.min(Math.max(pageNumber - 1, 0), readerPageOffsets.length - 1);
    return readerPageOffsets[idx] + readerListTopOffsetPx;
  }

  /**
   * Recomputes the whole page layout from readerPageAspects at the current
   * readerBaseWidthPx * readerZoom width — used by orientation/resize and by
   * zoom changes. Rendered pages are evicted and re-observed so the
   * IntersectionObserver re-renders the visible ones at the new width.
   *
   * `focus` is a viewport point (relative to readerScroll's box) whose
   * underlying content point must stay put across the relayout. The anchor is
   * kept as page + in-page fraction, so the fixed inter-page gaps can't
   * accumulate drift on long documents.
   */
  function relayoutReader(focus?: { viewportX: number; viewportY: number }): void {
    if (!readerDoc) return;
    const numPages = readerPageAspects.length;
    if (numPages === 0) return;
    const newLayoutW = readerBaseWidthPx * readerZoom;

    let anchor: { idx: number; fracY: number; fracX: number } | null = null;
    if (focus && readerPageOffsets.length === numPages && readerLayoutWidthPx > 0) {
      const cy = readerScroll.scrollTop + focus.viewportY;
      const cx = readerScroll.scrollLeft + focus.viewportX;
      const idx = Math.min(readerPageAtScrollTop(cy) - 1, numPages - 1);
      const fracY =
        readerPageHeights[idx] > 0
          ? (cy - readerListTopOffsetPx - readerPageOffsets[idx]) / readerPageHeights[idx]
          : 0;
      anchor = {
        idx,
        fracY: Math.min(Math.max(fracY, 0), 1),
        fracX: Math.min(Math.max(cx / readerLayoutWidthPx, 0), 1),
      };
    }

    readerPageHeights = new Array<number>(numPages);
    readerPageOffsets = new Array<number>(numPages);
    let acc = 0;
    for (let i = 0; i < numPages; i += 1) {
      readerPageHeights[i] = newLayoutW * readerPageAspects[i];
      readerPageOffsets[i] = acc;
      acc += readerPageHeights[i] + READER_PAGE_GAP_PX;
    }
    readerPageList.style.setProperty('--reader-page-width', `${newLayoutW}px`);
    readerLayoutWidthPx = newLayoutW;
    readerScroll.classList.toggle('is-zoomed', readerZoom > 1);

    readerPageList.querySelectorAll<HTMLDivElement>('.reader-page').forEach((el) => {
      const pageNumber = Number(el.dataset.pageNumber);
      el.style.height = `${readerPageHeights[pageNumber - 1]}px`;
      if (readerRendered.has(pageNumber)) {
        // Stretch-and-swap instead of evicting: keep the old (now blurry)
        // canvas visible at the new size until the sharp re-render lands —
        // renderReaderPageInto swaps the wrapper atomically. Dropping the
        // map entry is what makes the re-observed IO callback re-render.
        const wrapper = el.querySelector<HTMLDivElement>('.pdf-page-wrapper');
        if (wrapper) {
          wrapper.style.width = `${newLayoutW}px`;
          wrapper.style.height = `${readerPageHeights[pageNumber - 1]}px`;
          // The old text layer is scaled for the outgoing width — hide it
          // rather than leave mis-aligned selectable text in the interim.
          const textLayer = wrapper.querySelector<HTMLElement>('.textLayer');
          if (textLayer) textLayer.style.display = 'none';
        }
        readerRendered.delete(pageNumber);
      }
      // Re-observing forces an initial IntersectionObserver callback, which
      // re-renders pages that are already in the viewport (a plain content
      // change would not re-fire the observer).
      readerObserver?.unobserve(el);
      readerObserver?.observe(el);
    });

    if (anchor && focus) {
      readerScroll.scrollTop =
        readerListTopOffsetPx +
        readerPageOffsets[anchor.idx] +
        anchor.fracY * readerPageHeights[anchor.idx] -
        focus.viewportY;
      readerScroll.scrollLeft = anchor.fracX * newLayoutW - focus.viewportX;
    }
    // The scroll restore above is programmatic — sync the auto-hide baseline
    // so the resulting scroll event can't flip the chrome.
    readerLastScrollTop = readerScroll.scrollTop;
    updateScrubberThumb();
    scheduleReaderPageIndicatorUpdate();
  }

  // Search state
  type SearchMatch = { pageNumber: number; spanIndex: number; text: string };
  let searchMatches: SearchMatch[] = [];
  let searchCurrentIndex = -1;
  let searchActiveQuery = '';
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function showToast(message: string, opts?: { type?: 'info' | 'error' }): void {
    if (opts?.type === 'error') {
      errorLiveRegion.textContent = '';
      requestAnimationFrame(() => { errorLiveRegion.textContent = message; });
    }
    toast.textContent = message;
    toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
  }

  // ── Modal focus trap ────────────────────────────────────────────────────────

  const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  interface ModalEntry { el: HTMLElement; trigger: Element | null; onClose?: () => void }
  const modalStack: ModalEntry[] = [];

  function openModal(el: HTMLElement, trigger: Element | null = document.activeElement, onClose?: () => void): void {
    el.classList.remove('hidden');
    modalStack.push({ el, trigger, onClose });
    requestAnimationFrame(() => {
      const first = el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      first?.focus();
    });
  }

  function closeModal(el: HTMLElement): void {
    el.classList.add('hidden');
    const idx = modalStack.findLastIndex((m) => m.el === el);
    if (idx !== -1) {
      const { trigger, onClose } = modalStack[idx];
      modalStack.splice(idx, 1);
      if (trigger instanceof HTMLElement) {
        requestAnimationFrame(() => (trigger as HTMLElement).focus());
      }
      onClose?.();
    }
  }

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (modalStack.length === 0) return;
    const { el } = modalStack[modalStack.length - 1];
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal(el);
      return;
    }
    if (e.key === 'Tab') {
      const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (node) => !node.closest('[hidden]') && getComputedStyle(node).display !== 'none',
      );
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });

  // ── Confirm dialog ──────────────────────────────────────────────────────────

  const confirmModal = byId<HTMLDivElement>('confirmModal');
  const confirmModalMsg = byId<HTMLParagraphElement>('confirmModalMsg');
  const confirmYesBtn = byId<HTMLButtonElement>('confirmYesBtn');
  const confirmNoBtn = byId<HTMLButtonElement>('confirmNoBtn');
  const errorLiveRegion = byId<HTMLDivElement>('errorLiveRegion');

  function showConfirmDialog(message: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      confirmModalMsg.textContent = message;
      let result = false;
      const handleYes = () => { result = true;  closeModal(confirmModal); };
      const handleNo  = () => { result = false; closeModal(confirmModal); };
      const cleanup = () => {
        confirmYesBtn.removeEventListener('click', handleYes);
        confirmNoBtn.removeEventListener('click', handleNo);
      };
      confirmYesBtn.addEventListener('click', handleYes);
      confirmNoBtn.addEventListener('click', handleNo);
      openModal(confirmModal, document.activeElement, () => { cleanup(); resolve(result); });
    });
  }

  function getCurrentScreenId(): ScreenId {
    return (Object.entries(screens).find(([, el]) => !el.classList.contains('hidden'))?.[0] ??
      'hub') as ScreenId;
  }

  function updateBottomNavActive(tab: string): void {
    bottomNav.querySelectorAll('.bottom-nav-item').forEach((item) => {
      const btn = item as HTMLButtonElement;
      const isActive = btn.dataset.nav === tab;
      btn.classList.toggle('is-active', isActive);
    });
  }

  function showScreen(id: ScreenId): void {
    if (getCurrentScreenId() === 'reader' && id !== 'reader') {
      void closeReaderDocument();
      void ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
      setReaderChromeHidden(false);
      readerScrubber.classList.remove('is-visible');
      resetReaderZoomState();
    }
    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle('hidden', key !== id);
    }
    topBarTitle.textContent = t(SCREEN_TITLES[id]);

    const isTab = id === 'hub' || id === 'files' || id === 'settings';
    backBtn.hidden = isTab;

    const isReader = id === 'reader';
    savePdfBtn.hidden = !isReader;
    sharePdfBtn.hidden = !isReader;

    bottomNav.classList.toggle('hidden', !isTab);
    if (isTab) {
      updateBottomNavActive(id);
    }

    if (id === 'reader') {
      void ScreenOrientation.unlock().catch(() => {});
    } else if (id === 'hub') {
      void renderHubRecentsGrid();
      // Only after onboarding (on first run the hub sits behind the onboarding
      // overlay; finishOnboarding() triggers the intro instead).
      if (localStorage.getItem('bindery.onboarded') === 'true') requestHeroIntro();
    } else if (id === 'recents') {
      void renderRecentsListLarge();
    } else if (id === 'files') {
      void renderFilesList();
    }
    updateReaderNightChrome();
  }

  function updateReaderNightChrome(): void {
    document.documentElement.classList.toggle(
      'reader-night',
      getCurrentScreenId() === 'reader' && readerNightMode,
    );
  }

  function resetPicker(): void {
    selectedFile = null;
    fileCard.classList.add('hidden');
    continueBtn.classList.add('hidden');
    pickFileBtn.classList.remove('hidden');
    mixedSizeWarning.classList.add('hidden');
    bookletFlipEdge = 'short';
    setActiveSegment(flipEdgeGroup, 'flip', 'short');
    bookletPaperSize = 'A4';
    setActiveSegment(paperSizeGroup, 'paper', 'A4');
    bookletSignature = 'single';
    setActiveSegment(signatureSizeGroup, 'sig', 'single');
    bookletBinding = 'ltr';
    setActiveSegment(bindingGroup, 'binding', 'ltr');
    bookletSeparateCover = false;
    setActiveSegment(coverModeGroup, 'cover', 'together');
    bookletIncludeInstructions = false;
    setActiveSegment(instructionsGroup, 'instr', 'none');
    insertBlankInput.value = '';
    insertBlankError.classList.add('hidden');
    bookletOriginalPages = 0;
    updateCoverAvailability();
    refreshConfigSummary();
    setAdvancedOpen(false);
    updateAdvancedBadge();
  }

  // Maps the segmented signature value to the engine option.
  function signatureOption(): number | 'auto' | undefined {
    if (bookletSignature === 'single') return undefined;
    if (bookletSignature === 'auto') return 'auto';
    return Number(bookletSignature);
  }

  // How many PDFs a save will write: front, back, combined, plus optional cover
  // and instructions.
  function savedPdfCount(): number {
    if (!booklet) return 3;
    return 3 + (booklet.coverPdf ? 1 : 0) + (booklet.instructionsPdf ? 1 : 0);
  }

  // Keeps the save button label in sync with state and PDF count / language.
  function refreshSaveLabel(): void {
    bookletSaveBtnLabel.textContent =
      bookletSaveState === 'saved'
        ? t('common.saved')
        : t('booklet.saveAll', { count: savedPdfCount() });
  }

  // A separate cover needs the original document to have at least 8 pages
  // (2+2 cover + at least one inner sheet). The rule is on ORIGINAL pages, not
  // the blank-inflated logical order — matching the engine's validation. Disables
  // the "separate" option and swaps the hint when the document is too short.
  function updateCoverAvailability(): void {
    const separateBtn = coverModeGroup.querySelector<HTMLButtonElement>('[data-cover="separate"]');
    const tooFew = bookletOriginalPages > 0 && bookletOriginalPages < 8;
    if (separateBtn) separateBtn.disabled = tooFew;
    if (tooFew && bookletSeparateCover) {
      bookletSeparateCover = false;
      setActiveSegment(coverModeGroup, 'cover', 'together');
    }
    coverHintText.textContent = tooFew ? t('config.coverDisabledHint') : t('config.coverHint');
  }

  // True when any control inside the Advanced accordion differs from its
  // default, so a "modified" badge can warn the user about settings hidden
  // behind the collapsed panel. Defaults: flip=short, binding=ltr, gutter=0,
  // creep=0, cover=together, instructions=none, blank field empty.
  function isAdvancedModified(): boolean {
    return (
      bookletFlipEdge !== 'short' ||
      bookletBinding !== 'ltr' ||
      Number(gutterSlider.value) !== 0 ||
      Number(creepSlider.value) !== 0 ||
      bookletSeparateCover ||
      bookletIncludeInstructions ||
      insertBlankInput.value.trim() !== ''
    );
  }

  function updateAdvancedBadge(): void {
    advancedBadge.classList.toggle('hidden', !isAdvancedModified());
  }

  function setAdvancedOpen(open: boolean): void {
    advancedPanel.classList.toggle('hidden', !open);
    advancedToggle.classList.toggle('is-open', open);
    advancedToggle.setAttribute('aria-expanded', String(open));
  }

  // Short paper label for the summary band ("A4" / "Letter" / "Kaynak" ...).
  function paperSummaryLabel(): string {
    return bookletPaperSize === 'source' ? t('config.summary.source') : String(bookletPaperSize);
  }

  // Live "A4 · 52 pages -> 13 sheets · 4 signatures" band. Uses the engine's pure
  // functions so the imposition math is never duplicated. `pages` shown is the
  // LOGICAL page count (original + inserted blanks) — the user's own reality;
  // the sheet count then rounds up naturally (e.g. 52 pages -> 12 sheets + cover).
  function refreshConfigSummary(): void {
    if (!selectedFile || bookletOriginalPages <= 0) {
      configSummary.classList.add('hidden');
      return;
    }
    const parsed = parseInsertBlank();
    const blanks = parsed === null ? 0 : parsed.length;
    const logical = bookletOriginalPages + blanks;
    // Defensive: separate cover on a too-short doc (button is disabled, so this
    // is only a guard) shows the cover warning instead of a summary.
    if (bookletSeparateCover && bookletOriginalPages < 8) {
      configSummary.textContent = t('config.coverDisabledHint');
      configSummary.classList.remove('hidden');
      return;
    }
    const block = bookletSeparateCover ? logical - 4 : logical;
    const padded = Math.max(4, Math.ceil(block / 4) * 4);
    const sheets = padded / 4;
    const sigs = computeSignatureMappings(padded, signatureOption()).length;

    let text = t('config.summary', {
      paper: paperSummaryLabel(),
      pages: logical,
      sheets,
      sigs,
    });
    if (bookletSeparateCover) text += t('config.summaryCover');
    if (bookletIncludeInstructions) text += t('config.summaryInstructions');
    configSummary.textContent = text;
    configSummary.classList.remove('hidden');
  }

  // Parses the comma-separated "insert blank after" field. Returns the page
  // numbers, [] when empty (feature off), or null if a token is not a
  // non-negative integer (range is validated by the engine).
  function parseInsertBlank(): number[] | null {
    const raw = insertBlankInput.value.trim();
    if (!raw) return [];
    const tokens = raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const positions: number[] = [];
    for (const token of tokens) {
      const n = Number(token);
      if (!Number.isInteger(n) || n < 0) return null;
      positions.push(n);
    }
    return positions;
  }

  function goToError(title: string, message: string, returnTo: ScreenId): void {
    returnScreenOnError = returnTo;
    errorTitle.textContent = title;
    errorMessage.textContent = message;
    showScreen('error');
  }

  toolRows.forEach((row) => {
    row.addEventListener('click', () => {
      const tool = row.dataset.tool;
      if (!tool) return; // sort-sheet rows reuse .tool-row styling but are not tools
      const enabled = row.dataset.enabled === 'true';
      const entryScreen = tool ? TOOL_ENTRY_SCREEN[tool] : undefined;
      if (enabled && entryScreen) {
        showScreen(entryScreen);
        return;
      }
      showToast(t('toast.comingSoon'));
    });
  });

  hubSearchInput.addEventListener('input', () => {
    const query = hubSearchInput.value.trim().toLowerCase();
    for (const row of carouselToolRows) {
      const title = row.querySelector('.tool-row-title')?.textContent?.toLowerCase() ?? '';
      const matches = query === '' || title.includes(query);
      row.classList.toggle('hidden', !matches);
    }
  });

  bottomNav.querySelectorAll<HTMLButtonElement>('.bottom-nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const nav = item.dataset.nav as ScreenId;
      if (nav) {
        showScreen(nav);
      }
    });
  });

  recentsViewAllBtn.addEventListener('click', () => {
    showScreen('recents');
  });

  toolsViewAllBtn.addEventListener('click', () => {
    showScreen('tools-all');
  });

  let currentPickerPath = '';
  let selectedPickerFiles: { name: string; uri: string }[] = [];
  let pickerResolve: ((value: any) => void) | null = null;

  function renderBinderyPickerBreadcrumb(): void {
    binderyPickerBreadcrumb.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'breadcrumb-item';
    btn.textContent = t('files.root');
    btn.addEventListener('click', () => {
      currentPickerPath = '';
      void renderBinderyPickerList(binderyPickerConfirmBtn.classList.contains('hidden') ? false : true);
    });
    binderyPickerBreadcrumb.appendChild(btn);

    if (currentPickerPath) {
      const parts = currentPickerPath.split('/');
      let pathAcc = '';
      parts.forEach((part) => {
        pathAcc = pathAcc ? `${pathAcc}/${part}` : part;
        const currentPath = pathAcc;
        const separator = document.createElement('span');
        separator.className = 'breadcrumb-separator';
        separator.textContent = ' › ';
        binderyPickerBreadcrumb.appendChild(separator);

        const folderBtn = document.createElement('button');
        folderBtn.className = 'breadcrumb-item';
        folderBtn.textContent = part;
        folderBtn.addEventListener('click', () => {
          currentPickerPath = currentPath;
          void renderBinderyPickerList(binderyPickerConfirmBtn.classList.contains('hidden') ? false : true);
        });
        binderyPickerBreadcrumb.appendChild(folderBtn);
      });
    }
  }

  async function renderBinderyPickerList(allowMultiple: boolean): Promise<void> {
    renderBinderyPickerBreadcrumb();
    const items = await listPrivateFolder(currentPickerPath);
    binderyPickerList.innerHTML = '';

    const pdfItems = items.filter(
      (item) => item.type === 'directory' || item.name.toLowerCase().endsWith('.pdf')
    );
    const isEmpty = pdfItems.length === 0;
    binderyPickerEmptyHint.classList.toggle('hidden', !isEmpty);

    for (const item of pdfItems) {
      const isDir = item.type === 'directory';

      const card = document.createElement('div');
      card.className = 'file-item-card';
      if (isDir) card.classList.add('is-folder');

      const icon = document.createElement('span');
      icon.className = 'file-item-icon';
      icon.textContent = isDir ? '📂' : '📄';
      icon.ariaHidden = 'true';
      card.appendChild(icon);

      const details = document.createElement('div');
      details.className = 'file-item-details';

      const nameEl = document.createElement('span');
      nameEl.className = 'file-item-name';
      nameEl.textContent = item.name;
      details.appendChild(nameEl);

      const meta = document.createElement('span');
      meta.className = 'file-item-meta';
      if (isDir) {
        meta.textContent = t('common.folder');
      } else {
        meta.textContent = formatBytes(item.size);
      }
      details.appendChild(meta);

      card.appendChild(details);

      const isSelected = selectedPickerFiles.some((f) => f.uri === item.uri);
      if (!isDir && isSelected) {
        card.classList.add('is-selected');
      }

      card.addEventListener('click', async () => {
        if (isDir) {
          currentPickerPath = currentPickerPath ? `${currentPickerPath}/${item.name}` : item.name;
          void renderBinderyPickerList(allowMultiple);
        } else {
          if (allowMultiple) {
            const idx = selectedPickerFiles.findIndex((f) => f.uri === item.uri);
            if (idx >= 0) {
              selectedPickerFiles.splice(idx, 1);
              card.classList.remove('is-selected');
            } else {
              selectedPickerFiles.push({ name: item.name, uri: item.uri });
              card.classList.add('is-selected');
            }
            binderyPickerConfirmBtn.disabled = selectedPickerFiles.length === 0;
          } else {
            closeModal(binderyFilePickerModal);
            try {
              const picked = await readPdfFromUri(item.uri);
              pickerResolve?.(picked);
            } catch (err) {
              if (err instanceof FileTooLargeError) {
                showToast(t('toast.fileTooLarge', { mb: Math.round(err.sizeBytes / 1048576) }), { type: 'error' });
              } else {
                showToast(t('toast.fileOpenError'));
              }
              pickerResolve?.(null);
            }
          }
        }
      });

      binderyPickerList.appendChild(card);
    }
  }

  function promptAndPickPdfs(options: { allowMultiple: boolean }): Promise<any> {
    return new Promise((resolve) => {
      pickerResolve = resolve;

      const handleDevice = async () => {
        closeModal(pdfSourceModal);
        cleanupSourceListeners();
        try {
          if (options.allowMultiple) {
            const res = await pickPdfs();
            resolve(res);
          } else {
            const res = await pickPdf();
            resolve(res);
          }
        } catch (err) {
          if (err instanceof FileTooLargeError) {
            showToast(t('toast.fileTooLarge', { mb: Math.round(err.sizeBytes / 1048576) }), { type: 'error' });
          }
          resolve(options.allowMultiple ? [] : null);
        }
      };

      const handleBindery = () => {
        closeModal(pdfSourceModal);
        cleanupSourceListeners();

        currentPickerPath = '';
        selectedPickerFiles = [];

        openModal(binderyFilePickerModal);
        if (options.allowMultiple) {
          binderyPickerConfirmBtn.classList.remove('hidden');
          binderyPickerConfirmBtn.disabled = true;
        } else {
          binderyPickerConfirmBtn.classList.add('hidden');
        }

        void renderBinderyPickerList(options.allowMultiple);
      };

      const handleCancel = () => {
        closeModal(pdfSourceModal);
        cleanupSourceListeners();
        resolve(options.allowMultiple ? [] : null);
      };

      const cleanupSourceListeners = () => {
        pdfSourceDeviceBtn.removeEventListener('click', handleDevice);
        pdfSourceBinderyBtn.removeEventListener('click', handleBindery);
        pdfSourceCancelBtn.removeEventListener('click', handleCancel);
      };

      pdfSourceDeviceBtn.addEventListener('click', handleDevice);
      pdfSourceBinderyBtn.addEventListener('click', handleBindery);
      pdfSourceCancelBtn.addEventListener('click', handleCancel);

      openModal(pdfSourceModal);
    });
  }

  binderyPickerCancelBtn.addEventListener('click', () => {
    closeModal(binderyFilePickerModal);
    pickerResolve?.(binderyPickerConfirmBtn.classList.contains('hidden') ? null : []);
  });

  binderyPickerConfirmBtn.addEventListener('click', async () => {
    closeModal(binderyFilePickerModal);
    try {
      const pickedList = await Promise.all(
        selectedPickerFiles.map((file) => readPdfFromUri(file.uri))
      );
      pickerResolve?.(pickedList);
    } catch (err) {
      if (err instanceof FileTooLargeError) {
        showToast(t('toast.fileTooLarge', { mb: Math.round(err.sizeBytes / 1048576) }), { type: 'error' });
      } else {
        showToast(t('toast.fileOpenError'));
      }
      pickerResolve?.([]);
    }
  });

  function loadBookletFile(bytes: Uint8Array, name: string): void {
    selectedFile = { name, bytes };
    fileNameLabel.textContent = name;
    fileSizeLabel.textContent = formatBytes(bytes.length);
    fileCard.classList.remove('hidden');
    pickFileBtn.classList.add('hidden');
    continueBtn.classList.remove('hidden');
    mixedSizeWarning.classList.add('hidden');
    void showMixedSizeWarningIfNeeded(bytes);
  }

  // Non-blocking heads-up: if the document mixes page sizes (beyond a small
  // tolerance), the booklet's per-slot scaling will differ page to page. Also
  // captures the page count for the live summary and cover availability.
  async function showMixedSizeWarningIfNeeded(bytes: Uint8Array): Promise<void> {
    try {
      const { pageCount, pageSizes } = await validatePdf(bytes);
      const TOL = 0.5;
      const distinct = pageSizes.filter(
        ([w, h], i) =>
          pageSizes.findIndex(
            ([w0, h0]) => Math.abs(w0 - w) <= TOL && Math.abs(h0 - h) <= TOL,
          ) === i,
      );
      // Guard against a race where the user cleared/replaced the file meanwhile.
      if (selectedFile?.bytes === bytes) {
        mixedSizeWarning.classList.toggle('hidden', distinct.length <= 1);
        bookletOriginalPages = pageCount;
        updateCoverAvailability();
        refreshConfigSummary();
      }
    } catch {
      // Validation errors surface later on generate; don't block the warning path.
    }
  }

  pickFileBtn.addEventListener('click', async () => {
    showToast(t('toast.selectingSource'));
    try {
      const picked = await promptAndPickPdfs({ allowMultiple: false });
      if (!picked) {
        return;
      }
      loadBookletFile(picked.bytes, picked.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      goToError(t('error.fileSelectFailed'), message, 'picker');
    }
  });

  clearFileBtn.addEventListener('click', () => resetPicker());

  continueBtn.addEventListener('click', () => {
    updateCoverAvailability();
    refreshConfigSummary();
    setAdvancedOpen(false);
    updateAdvancedBadge();
    showScreen('config');
  });

  gutterSlider.addEventListener('input', () => {
    gutterValueLabel.textContent = `${gutterSlider.value} pt`;
    updateAdvancedBadge();
  });

  creepSlider.addEventListener('input', () => {
    creepValueLabel.textContent = `${Number(creepSlider.value).toFixed(1)} pt`;
    updateAdvancedBadge();
  });

  paperSizeGroup.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
    const paper = btn?.dataset.paper;
    if (!paper) return;
    bookletPaperSize = paper as PaperSize;
    setActiveSegment(paperSizeGroup, 'paper', paper);
    refreshConfigSummary();
  });

  flipEdgeGroup.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
    if (!btn) return;
    const flip = btn.dataset.flip === 'long' ? 'long' : 'short';
    bookletFlipEdge = flip;
    setActiveSegment(flipEdgeGroup, 'flip', flip);
    updateAdvancedBadge();
  });

  signatureSizeGroup.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
    const sig = btn?.dataset.sig;
    if (!sig) return;
    bookletSignature = sig;
    setActiveSegment(signatureSizeGroup, 'sig', sig);
    refreshConfigSummary();
  });

  // ── "What is a signature?" interactive info sheet ───────────────────────────
  {
    interface Scenario {
      key: string; sheetsPerSig: number; sigCount: number;
      single: boolean; auto: boolean;
      leaves: number; pages: number; pagesPerSig: number;
    }
    const mk = (
      key: string, sheetsPerSig: number, sigCount: number,
      opts: { single?: boolean; auto?: boolean } = {},
    ): Scenario => ({
      key, sheetsPerSig, sigCount,
      single: !!opts.single, auto: !!opts.auto,
      leaves: sheetsPerSig * sigCount,
      pages: sheetsPerSig * sigCount * 4,
      pagesPerSig: opts.single ? sheetsPerSig * sigCount * 4 : sheetsPerSig * 4,
    });
    // Each selected size → an honest, readable example (sheetsPerSig = size ÷ 4).
    const SCEN: Record<string, Scenario> = {
      single: mk('single', 6, 1, { single: true }),
      '8': mk('8', 2, 3),
      '16': mk('16', 4, 3),
      '32': mk('32', 8, 2),
      auto: mk('auto', 4, 3, { auto: true }),
    };

    const sheet = byId<HTMLDivElement>('signatureInfoSheet');
    const stage = byId<HTMLDivElement>('signatureInfoStage');
    const deck = byId<HTMLDivElement>('signatureInfoDeck');
    const infoBtn = byId<HTMLButtonElement>('signatureInfoBtn');
    const bridgeEl = byId<HTMLDivElement>('signatureInfoBridge');
    const tagEl = byId<HTMLSpanElement>('signatureInfoTag');
    const stepNameEl = byId<HTMLSpanElement>('signatureInfoStepName');
    const stepTextEl = byId<HTMLParagraphElement>('signatureInfoStepText');
    const picker = byId<HTMLDivElement>('signatureInfoPicker');
    const dots = Array.from(document.querySelectorAll<HTMLElement>('.imza-dots i'));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    let cover: HTMLDivElement | null = null;
    function ensureCover(): void {
      if (!cover) {
        cover = document.createElement('div');
        cover.className = 'imza-cover';
        cover.innerHTML = '<div class="imza-emboss"></div>';
      }
      if (cover.parentElement !== deck) deck.appendChild(cover);
    }
    function buildLeaves(n: number, per: number): void {
      deck.querySelectorAll('.imza-leaf').forEach((el) => el.remove());
      const frag = document.createDocumentFragment();
      for (let i = 0; i < n; i++) {
        const leaf = document.createElement('div');
        leaf.className = 'imza-leaf';
        leaf.style.setProperty('--i', String(i));
        leaf.style.setProperty('--g', String(Math.floor(i / per)));
        leaf.style.setProperty('--j', String(i % per));
        leaf.innerHTML =
          '<div class="imza-face l"><div class="imza-paper"></div><div class="imza-foldshade"></div></div>' +
          '<div class="imza-face r"><div class="imza-paper"></div><div class="imza-paper back"></div><div class="imza-foldshade"></div><div class="imza-hingeline"></div></div>';
        frag.appendChild(leaf);
      }
      deck.appendChild(frag);
    }
    const clampMax = (v: number, max: number): number => (v < max ? v : max);
    function setStageVars(s: Scenario): void {
      const st = stage.style; const n = s.sheetsPerSig;
      st.setProperty('--icenter', String((s.leaves - 1) / 2));
      st.setProperty('--center', String((s.sigCount - 1) / 2));
      st.setProperty('--jcenter', String((n - 1) / 2));
      st.setProperty('--col', `${s.sigCount >= 3 ? 92 : s.sigCount === 2 ? 116 : 0}px`);
      st.setProperty('--fanY', `${clampMax(20 / n, 5)}px`);
      st.setProperty('--fanZ', `${clampMax(7 / n, 1.6)}deg`);
      st.setProperty('--nest', `${10 / n}deg`);
      st.setProperty('--nestZ', `${clampMax(8 / n, 1.4)}px`);
    }

    interface Step { phase: string; n: string; nameKey: string; tone: string; dot: number; text: string; hold: number; }
    function sizeLabel(s: Scenario): string {
      if (s.single) return t('config.signature.single');
      if (s.auto) return t('signatureInfo.autoResolved');
      return s.key;
    }
    function buildSteps(s: Scenario): Step[] {
      const p = {
        pages: s.pages, sheets: s.sheetsPerSig,
        pagesPerSig: s.pagesPerSig, sigs: s.sigCount, size: sizeLabel(s),
      };
      return [
        { phase: 'print', n: '01', nameKey: 'signatureInfo.name.print', tone: 'neutral', dot: 0, text: t('signatureInfo.step.print', p), hold: 3200 },
        { phase: 'group', n: '02', nameKey: 'signatureInfo.name.group', tone: 'neutral', dot: 1, text: s.single ? t('signatureInfo.step.groupSingle', p) : t('signatureInfo.step.group', p), hold: 4400 },
        { phase: 'fold', n: '03', nameKey: 'signatureInfo.name.fold', tone: 'neutral', dot: 2, text: s.single ? t('signatureInfo.step.foldSingle', p) : t('signatureInfo.step.fold', p), hold: 4800 },
        { phase: 'bind', n: '04', nameKey: 'signatureInfo.name.bind', tone: 'good', dot: 3, text: s.single ? t('signatureInfo.step.bindSingle', p) : t('signatureInfo.step.bind', p), hold: 5200 },
      ];
    }

    let steps: Step[] = buildSteps(SCEN['16']);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let idx = 0;
    let currentSize = '16';

    function render(step: Step): void {
      stage.setAttribute('data-phase', step.phase);
      tagEl.setAttribute('data-tone', step.tone);
      const nEl = tagEl.querySelector('.n');
      if (nEl) nEl.textContent = step.n;
      stepNameEl.textContent = t(step.nameKey);
      stepTextEl.innerHTML = step.text;
      dots.forEach((d, k) => {
        d.classList.toggle('on', k === step.dot);
        d.classList.toggle('done', k < step.dot);
      });
    }
    function runStep(): void {
      render(steps[idx]);
      if (idx < steps.length - 1) {
        timer = setTimeout(() => { idx++; runStep(); }, steps[idx].hold);
      }
    }
    function play(): void {
      if (timer) clearTimeout(timer);
      idx = 0;
      stage.setAttribute('data-phase', 'load');
      void stage.offsetWidth;
      runStep();
    }
    function showFinal(): void {
      if (timer) clearTimeout(timer);
      idx = steps.length - 1;
      render(steps[idx]);
    }
    function stopAnim(): void { if (timer) { clearTimeout(timer); timer = null; } }

    const normalizeSize = (size: string): string => (SCEN[size] ? size : '16');
    function updateChrome(s: Scenario): void {
      bridgeEl.innerHTML = t('signatureInfo.bridge');
      picker.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        b.setAttribute('aria-pressed', b.dataset.size === s.key ? 'true' : 'false');
      });
    }
    function applyScenario(size: string): void {
      const s = SCEN[normalizeSize(size)];
      currentSize = s.key;
      steps = buildSteps(s);
      setStageVars(s);
      updateChrome(s);
      ensureCover();
      if (reduceMotion.matches) {
        stage.setAttribute('data-phase', 'bind');
        buildLeaves(s.leaves, s.sheetsPerSig);
        showFinal();
      } else {
        stage.setAttribute('data-phase', 'load'); // create new leaves already hidden
        buildLeaves(s.leaves, s.sheetsPerSig);
        void stage.offsetWidth;
        play();
      }
    }

    infoBtn.addEventListener('click', () => {
      applyScenario(normalizeSize(bookletSignature)); // reflect the card's current size
      openModal(sheet, infoBtn, stopAnim);
      // No grabber / no X: focus the dialog itself so nothing is pre-selected.
      // Runs after openModal's own focus rAF, so it wins. Esc / backdrop / "Got it" close.
      requestAnimationFrame(() => sheet.focus());
    });
    // in-sheet picker teaches only — it never changes the real setting
    picker.addEventListener('click', (event) => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (b?.dataset.size) applyScenario(b.dataset.size);
    });
    byId<HTMLButtonElement>('signatureInfoReplay').addEventListener('click', () => applyScenario(currentSize));
    byId<HTMLButtonElement>('signatureInfoGotIt').addEventListener('click', () => closeModal(sheet));
    byId<HTMLDivElement>('signatureInfoBackdrop').addEventListener('click', () => closeModal(sheet));
  }

  bindingGroup.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
    if (!btn) return;
    const binding = btn.dataset.binding === 'rtl' ? 'rtl' : 'ltr';
    bookletBinding = binding;
    setActiveSegment(bindingGroup, 'binding', binding);
    updateAdvancedBadge();
  });

  coverModeGroup.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
    const cover = btn?.dataset.cover;
    if (!cover) return;
    bookletSeparateCover = cover === 'separate';
    setActiveSegment(coverModeGroup, 'cover', cover);
    refreshConfigSummary();
    updateAdvancedBadge();
  });

  instructionsGroup.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
    const instr = btn?.dataset.instr;
    if (!instr) return;
    bookletIncludeInstructions = instr === 'add';
    setActiveSegment(instructionsGroup, 'instr', instr);
    refreshConfigSummary();
    updateAdvancedBadge();
  });

  insertBlankInput.addEventListener('input', () => {
    insertBlankError.classList.add('hidden');
    refreshConfigSummary();
    updateAdvancedBadge();
  });

  advancedToggle.addEventListener('click', () => {
    const willOpen = advancedPanel.classList.contains('hidden');
    setAdvancedOpen(willOpen);
    if (willOpen) {
      advancedPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  generateBtn.addEventListener('click', async () => {
    if (!selectedFile) {
      showScreen('picker');
      return;
    }

    // Parse the "insert blank after" field up front. A malformed token is
    // reported inline (button stays enabled); out-of-range values are left to the
    // engine, which surfaces them through the normal error flow.
    const insertBlankAfter = parseInsertBlank();
    if (insertBlankAfter === null) {
      insertBlankError.textContent = t('config.insertBlankError');
      insertBlankError.classList.remove('hidden');
      return;
    }
    insertBlankError.classList.add('hidden');

    generateBtn.disabled = true;
    generateBtnLabel.classList.add('hidden');
    generateSpinner.classList.remove('hidden');

    try {
      const result = await makeBooklet(selectedFile.bytes, {
        gutter: Number(gutterSlider.value),
        creep: Number(creepSlider.value),
        flipEdge: bookletFlipEdge,
        paperSize: bookletPaperSize,
        signatureSize: signatureOption(),
        binding: bookletBinding,
        separateCover: bookletSeparateCover,
        includeInstructions: bookletIncludeInstructions,
        insertBlankAfter,
      });

      booklet = {
        frontPdf: result.frontPdf,
        backPdf: result.backPdf,
        combinedPdf: result.combinedPdf,
        coverPdf: result.coverPdf,
        instructionsPdf: result.instructionsPdf,
      };
      bookletSaveState = 'idle';
      bookletFileNameInput.value = selectedFile.name.replace(/\.pdf$/i, '');
      bookletSaveBtn.disabled = false;
      refreshSaveLabel();
      bookletSaveSpinner.classList.add('hidden');
      bookletGoToLocationBtn.classList.add('hidden');

      coverActionRow.classList.toggle('hidden', !booklet.coverPdf);
      instructionsActionRow.classList.toggle('hidden', !booklet.instructionsPdf);
      coverPreviewCell.classList.toggle('hidden', !booklet.coverPdf);

      statOriginal.textContent = String(result.originalPages);
      statSheets.textContent = String(result.sheetsCount);
      if (result.paddingApplied > 0) {
        statPadding.textContent = `+${result.paddingApplied}`;
        statPaddingCard.classList.remove('hidden');
      } else {
        statPaddingCard.classList.add('hidden');
      }
      if (result.signaturesCount > 1) {
        statSignatures.textContent = String(result.signaturesCount);
        statSignaturesCard.classList.remove('hidden');
      } else {
        statSignaturesCard.classList.add('hidden');
      }
      if (result.blanksInserted > 0) {
        statBlanks.textContent = `+${result.blanksInserted}`;
        statBlanksCard.classList.remove('hidden');
      } else {
        statBlanksCard.classList.add('hidden');
      }
      actionStatus.textContent = '';

      showScreen('result');
      void renderBookletPreviews();
    } catch (error) {
      const message =
        error instanceof BookletError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      goToError(t('error.bookletCreateFailed'), message, 'config');
    } finally {
      generateBtn.disabled = false;
      generateBtnLabel.classList.remove('hidden');
      generateSpinner.classList.add('hidden');
    }
  });

  // Renders page `pageIndex` (1-based) of `bytes` into one preview cell, owning
  // that cell's spinner/error state so front, back and cover all share one path.
  // renderPageThumbnail returns a data URL (not an object URL), so there is
  // nothing to revoke.
  async function renderPreviewInto(
    bytes: Uint8Array,
    imgEl: HTMLImageElement,
    spinnerEl: HTMLDivElement,
    errorEl: HTMLElement,
    pageIndex = 1,
  ): Promise<void> {
    spinnerEl.classList.remove('hidden');
    imgEl.classList.add('hidden');
    imgEl.src = '';
    errorEl.classList.add('hidden');
    try {
      const proxy = await loadPdfForThumbnails(bytes.slice());
      try {
        imgEl.src = await renderPageThumbnail(proxy, pageIndex, 160);
        imgEl.classList.remove('hidden');
      } finally {
        await destroyThumbnailDoc(proxy);
      }
    } catch {
      errorEl.classList.remove('hidden');
    } finally {
      spinnerEl.classList.add('hidden');
    }
  }

  async function renderBookletPreviews(): Promise<void> {
    if (!booklet) return;
    const jobs = [
      renderPreviewInto(booklet.frontPdf, frontPreviewImg, frontPreviewSpinner, frontPreviewError),
      renderPreviewInto(booklet.backPdf, backPreviewImg, backPreviewSpinner, backPreviewError),
    ];
    if (booklet.coverPdf) {
      // Cover front leaf is page 1 of coverPdf.
      jobs.push(
        renderPreviewInto(booklet.coverPdf, coverPreviewImg, coverPreviewSpinner, coverPreviewError),
      );
    }
    await Promise.allSettled(jobs);
  }

  document.querySelectorAll<HTMLButtonElement>('[data-target][data-action="share"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!booklet) return;
      const target = button.dataset.target as
        | 'front'
        | 'back'
        | 'combined'
        | 'cover'
        | 'instructions';
      const bytesByTarget: Record<typeof target, Uint8Array | undefined> = {
        front: booklet.frontPdf,
        back: booklet.backPdf,
        combined: booklet.combinedPdf,
        cover: booklet.coverPdf,
        instructions: booklet.instructionsPdf,
      };
      const bytes = bytesByTarget[target];
      if (!bytes) return;
      const filename = `${selectedFile?.name.replace(/\.pdf$/i, '') ?? 'booklet'}_${target}.pdf`;
      const labelKeyByTarget: Record<typeof target, string> = {
        front: 'booklet.frontSideLower',
        back: 'booklet.backSideLower',
        combined: 'booklet.combinedLower',
        cover: 'booklet.coverLower',
        instructions: 'booklet.instructionsLower',
      };
      const label = t(labelKeyByTarget[target]);

      try {
        await sharePdf(bytes, filename, `${label} PDF`);
        actionStatus.textContent = t('status.booklet.shared', { label });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actionStatus.textContent = t('status.booklet.actionFailed', { label, message });
      }
    });
  });

  bookletFileNameInput.addEventListener('input', () => {
    if (bookletSaveState === 'saved') {
      bookletSaveState = 'idle';
      bookletSaveBtn.disabled = false;
      refreshSaveLabel();
      bookletGoToLocationBtn.classList.add('hidden');
    }
  });

  bookletSaveBtn.addEventListener('click', async () => {
    if (!booklet || bookletSaveState === 'saving') return;

    let docName = bookletFileNameInput.value.trim();
    if (!docName) {
      showToast(t('toast.invalidFileName'));
      return;
    }
    docName = docName.replace(/[/\\:*?"<>|]/g, '_').replace(/\.pdf$/i, '');
    if (!docName) {
      showToast(t('toast.invalidFileName'));
      return;
    }

    if (await pathExists(`booklets/${docName}`)) {
      const overwrite = await showConfirmDialog(t('common.overwriteConfirm', { name: docName }));
      if (!overwrite) return;
    }

    bookletSaveState = 'saving';
    bookletSaveBtn.disabled = true;
    bookletSaveBtnLabel.classList.add('hidden');
    bookletSaveSpinner.classList.remove('hidden');

    try {
      const frontUri = await savePdfPrivately(booklet.frontPdf, `booklets/${docName}/Front Side.pdf`);
      await recordOpened({ uri: frontUri, name: `${docName} — Front Side.pdf` });
      const backUri = await savePdfPrivately(booklet.backPdf, `booklets/${docName}/Back Side.pdf`);
      await recordOpened({ uri: backUri, name: `${docName} — Back Side.pdf` });
      const combinedUri = await savePdfPrivately(booklet.combinedPdf, `booklets/${docName}/Combined Booklet.pdf`);
      await recordOpened({ uri: combinedUri, name: `${docName} — Combined Booklet.pdf` });
      if (booklet.coverPdf) {
        const coverUri = await savePdfPrivately(booklet.coverPdf, `booklets/${docName}/Cover.pdf`);
        await recordOpened({ uri: coverUri, name: `${docName} — Cover.pdf` });
      }
      if (booklet.instructionsPdf) {
        const instrUri = await savePdfPrivately(booklet.instructionsPdf, `booklets/${docName}/Instructions.pdf`);
        await recordOpened({ uri: instrUri, name: `${docName} — Instructions.pdf` });
      }
      bookletFileNameInput.value = docName;
      const savedFiles = [
        t('booklet.fileFront'),
        t('booklet.fileBack'),
        t('booklet.fileCombined'),
      ];
      if (booklet.coverPdf) savedFiles.push(t('booklet.fileCover'));
      if (booklet.instructionsPdf) savedFiles.push(t('booklet.fileInstructions'));
      actionStatus.textContent = t('status.booklet.savedList', {
        count: savedFiles.length,
        files: savedFiles.join(', '),
      });
      bookletSaveState = 'saved';
      refreshSaveLabel();
      bookletGoToLocationBtn.classList.remove('hidden');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actionStatus.textContent = t('status.saveFailed', { message });
      bookletSaveState = 'idle';
      bookletSaveBtn.disabled = false;
    } finally {
      bookletSaveBtnLabel.classList.remove('hidden');
      bookletSaveSpinner.classList.add('hidden');
    }
  });

  bookletGoToLocationBtn.addEventListener('click', () => {
    currentFolderPath = `booklets/${bookletFileNameInput.value.trim().replace(/[/\\:*?"<>|]/g, '_').replace(/\.pdf$/i, '')}`;
    showScreen('files');
  });

  newFileBtn.addEventListener('click', async () => {
    if (booklet !== null) {
      if (!(await showConfirmDialog(t('confirm.discardResult')))) return;
    }
    resetPicker();
    booklet = null;
    bookletSaveState = 'idle';
    bookletFileNameInput.value = '';
    bookletSaveBtn.disabled = false;
    refreshSaveLabel();
    bookletSaveSpinner.classList.add('hidden');
    bookletGoToLocationBtn.classList.add('hidden');
    coverActionRow.classList.add('hidden');
    instructionsActionRow.classList.add('hidden');
    frontPreviewImg.classList.add('hidden');
    frontPreviewImg.src = '';
    frontPreviewError.classList.add('hidden');
    frontPreviewSpinner.classList.remove('hidden');
    backPreviewImg.classList.add('hidden');
    backPreviewImg.src = '';
    backPreviewError.classList.add('hidden');
    backPreviewSpinner.classList.remove('hidden');
    coverPreviewCell.classList.add('hidden');
    coverPreviewImg.classList.add('hidden');
    coverPreviewImg.src = '';
    coverPreviewError.classList.add('hidden');
    coverPreviewSpinner.classList.remove('hidden');
    showScreen('picker');
  });

  function renderMergeList(): void {
    mergeFileList.innerHTML = '';
    mergeEmptyHint.classList.toggle('hidden', mergeFiles.length > 0);
    mergeRunBtn.disabled = mergeFiles.length < 2;

    mergeFiles.forEach((file, index) => {
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
      row.querySelector('.merge-file-size')!.textContent = formatBytes(file.bytes.length);

      const upBtn = row.querySelector<HTMLButtonElement>('[data-action="up"]')!;
      const downBtn = row.querySelector<HTMLButtonElement>('[data-action="down"]')!;
      upBtn.disabled = index === 0;
      downBtn.disabled = index === mergeFiles.length - 1;

      upBtn.addEventListener('click', () => {
        [mergeFiles[index - 1], mergeFiles[index]] = [mergeFiles[index], mergeFiles[index - 1]];
        renderMergeList();
      });
      downBtn.addEventListener('click', () => {
        [mergeFiles[index + 1], mergeFiles[index]] = [mergeFiles[index], mergeFiles[index + 1]];
        renderMergeList();
      });
      row.querySelector<HTMLButtonElement>('[data-action="remove"]')!.addEventListener('click', () => {
        mergeFiles.splice(index, 1);
        renderMergeList();
      });

      mergeFileList.appendChild(row);
    });
  }

  async function addMergeFile(bytes: Uint8Array, name: string): Promise<void> {
    await validatePdf(bytes);
    mergeFiles.push({ name, bytes });
    renderMergeList();
  }

  mergeAddFileBtn.addEventListener('click', async () => {
    showToast(t('toast.selectingSource'));
    let picked: PickedPdf[];
    try {
      picked = await promptAndPickPdfs({ allowMultiple: true });
      if (!picked || picked.length === 0) {
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t('toast.fileSelectError', { message }));
      return;
    }

    const rejected: string[] = [];
    for (const file of picked) {
      try {
        await validatePdf(file.bytes);
        mergeFiles.push(file);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rejected.push(`${file.name}: ${message}`);
      }
    }
    renderMergeList();
    if (rejected.length > 0) {
      showToast(t('toast.addFailed', { reason: rejected.join('; ') }));
    }
  });

  mergeRunBtn.addEventListener('click', async () => {
    if (mergeFiles.length < 2) return;

    mergeRunBtn.disabled = true;
    mergeRunBtnLabel.classList.add('hidden');
    mergeRunSpinner.classList.remove('hidden');
    try {
      const result = await mergePdfs(mergeFiles);
      mergedPdf = result.mergedPdf;
      mergeStatFiles.textContent = String(result.fileCount);
      mergeStatPages.textContent = String(result.pageCount);
      mergeActionStatus.textContent = '';
      mergeFileNameInput.value = generateDefaultMergeName();
      mergeSaveState = 'idle';
      mergeSaveBtn.disabled = false;
      mergeSaveBtnLabel.textContent = t('common.save');
      mergeSaveSpinner.classList.add('hidden');
      mergeGoToLocationBtn.classList.add('hidden');
      showScreen('merge-result');
    } catch (error) {
      const message =
        error instanceof BookletError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      goToError(t('error.mergeFailed'), message, 'merge-picker');
    } finally {
      mergeRunBtn.disabled = mergeFiles.length < 2;
      mergeRunBtnLabel.classList.remove('hidden');
      mergeRunSpinner.classList.add('hidden');
    }
  });

  mergeFileNameInput.addEventListener('input', () => {
    if (mergeSaveState === 'saved') {
      mergeSaveState = 'idle';
      mergeSaveBtn.disabled = false;
      mergeSaveBtnLabel.textContent = t('common.save');
      mergeGoToLocationBtn.classList.add('hidden');
    }
  });

  mergeSaveBtn.addEventListener('click', async () => {
    if (!mergedPdf || mergeSaveState === 'saving') return;

    let filename = mergeFileNameInput.value.trim();
    if (!filename) {
      showToast(t('toast.invalidFileName'));
      return;
    }
    filename = filename.replace(/[/\\:*?"<>|]/g, '_');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }

    const targetPath = `merges/${filename}`;
    if (await pathExists(targetPath)) {
      const overwrite = await showConfirmDialog(t('common.overwriteConfirm', { name: filename }));
      if (!overwrite) return;
    }

    mergeSaveState = 'saving';
    mergeSaveBtn.disabled = true;
    mergeSaveBtnLabel.classList.add('hidden');
    mergeSaveSpinner.classList.remove('hidden');

    try {
      const savedUri = await savePdfPrivately(mergedPdf, targetPath);
      await recordOpened({ uri: savedUri, name: filename });
      mergeFileNameInput.value = filename.replace(/\.pdf$/i, '');
      mergeActionStatus.textContent = t('status.merge.saved');
      mergeSaveState = 'saved';
      mergeSaveBtnLabel.textContent = t('common.saved');
      mergeGoToLocationBtn.classList.remove('hidden');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mergeActionStatus.textContent = t('status.saveFailed', { message });
      mergeSaveState = 'idle';
      mergeSaveBtn.disabled = false;
    } finally {
      mergeSaveBtnLabel.classList.remove('hidden');
      mergeSaveSpinner.classList.add('hidden');
    }
  });

  mergeGoToLocationBtn.addEventListener('click', () => {
    currentFolderPath = 'merges';
    showScreen('files');
  });

  mergeShareBtn.addEventListener('click', async () => {
    if (!mergedPdf) return;
    try {
      await sharePdf(mergedPdf, 'merged.pdf', t('merge.mergedPdf'));
      mergeActionStatus.textContent = t('status.shared');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mergeActionStatus.textContent = t('status.shareFailed', { message });
    }
  });

  mergeNewBtn.addEventListener('click', async () => {
    if (mergedPdf !== null && mergeSaveState !== 'saved') {
      if (!(await showConfirmDialog(t('confirm.discardResult')))) return;
    }
    mergeFiles = [];
    mergedPdf = null;
    renderMergeList();
    showScreen('merge-picker');
  });

  function resetOrganizeScreen(): void {
    organizeOriginalBytes = null;
    if (organizePdfDoc) void destroyThumbnailDoc(organizePdfDoc);
    organizePdfDoc = null;
    organizePageOrder = [];
    organizeThumbCache.clear();
    organizeResultPdf = null;
    organizeHero.classList.remove('hidden');
    organizePickBtn.classList.remove('hidden');
    organizePageList.classList.add('hidden');
    organizeApplyBtn.classList.add('hidden');
    organizePageList.innerHTML = '';
  }

  function renderOrganizeList(): void {
    organizeThumbObserver?.disconnect();
    organizePageList.innerHTML = '';
    organizeApplyBtn.disabled = organizePageOrder.length === 0;

    organizeThumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const thumbEl = entry.target as HTMLDivElement;
          organizeThumbObserver?.unobserve(thumbEl);
          const originalIndex = Number(thumbEl.dataset.pageIndex);
          loadThumbnail(thumbEl, originalIndex);
        }
      },
      { root: organizePageList, rootMargin: '200px' },
    );

    organizePageOrder.forEach((originalIndex, position) => {
      const row = document.createElement('div');
      row.className = 'organize-row';
      row.setAttribute('aria-label', t('common.pageLabel', { n: originalIndex + 1 }));
      row.innerHTML = `
        <div class="organize-thumb" data-page-index="${originalIndex}">
          <span class="organize-thumb-placeholder">…</span>
        </div>
        <span class="organize-page-label">${t('common.pageLabel', { n: originalIndex + 1 })}</span>
        <span class="merge-file-actions">
          <button type="button" class="icon-btn-sm" data-action="up" aria-label="${t('common.moveUp')}">↑</button>
          <button type="button" class="icon-btn-sm" data-action="down" aria-label="${t('common.moveDown')}">↓</button>
          <button type="button" class="icon-btn-sm" data-action="remove" aria-label="${t('common.remove')}">✕</button>
        </span>
      `;

      const thumbEl = row.querySelector<HTMLDivElement>('.organize-thumb')!;
      const cached = organizeThumbCache.get(originalIndex);
      if (cached) {
        thumbEl.innerHTML = `<img src="${cached}" alt="" />`;
      } else {
        organizeThumbObserver!.observe(thumbEl);
      }

      const upBtn = row.querySelector<HTMLButtonElement>('[data-action="up"]')!;
      const downBtn = row.querySelector<HTMLButtonElement>('[data-action="down"]')!;
      upBtn.disabled = position === 0;
      downBtn.disabled = position === organizePageOrder.length - 1;

      upBtn.addEventListener('click', () => {
        [organizePageOrder[position - 1], organizePageOrder[position]] = [
          organizePageOrder[position],
          organizePageOrder[position - 1],
        ];
        renderOrganizeList();
      });
      downBtn.addEventListener('click', () => {
        [organizePageOrder[position + 1], organizePageOrder[position]] = [
          organizePageOrder[position],
          organizePageOrder[position + 1],
        ];
        renderOrganizeList();
      });
      row.querySelector<HTMLButtonElement>('[data-action="remove"]')!.addEventListener('click', () => {
        organizePageOrder.splice(position, 1);
        renderOrganizeList();
      });

      organizePageList.appendChild(row);
    });
  }

  async function loadThumbnail(thumbEl: HTMLDivElement, originalIndex: number): Promise<void> {
    if (!organizePdfDoc) return;
    try {
      const dataUrl = await renderPageThumbnail(organizePdfDoc, originalIndex + 1);
      organizeThumbCache.set(originalIndex, dataUrl);
      if (document.contains(thumbEl)) {
        thumbEl.innerHTML = `<img src="${dataUrl}" alt="" />`;
      }
    } catch {
      if (document.contains(thumbEl)) {
        thumbEl.innerHTML = '<span class="organize-thumb-placeholder">?</span>';
      }
    }
  }

  async function loadOrganizeFile(bytes: Uint8Array, name: string): Promise<void> {
    await validatePdf(bytes);

    organizeOriginalBytes = bytes;
    organizeOriginalName = name.replace(/\.pdf$/i, '');
    // pdf.js's worker transport can transfer/detach the underlying ArrayBuffer
    // of the bytes it's given, so it gets a copy — organizeOriginalBytes must
    // stay intact for organizePages() later.
    if (organizePdfDoc) await destroyThumbnailDoc(organizePdfDoc);
    organizePdfDoc = await loadPdfForThumbnails(bytes.slice());
    organizePageOrder = Array.from({ length: organizePdfDoc.numPages }, (_, i) => i);
    organizeThumbCache.clear();

    organizeHero.classList.add('hidden');
    organizePickBtn.classList.add('hidden');
    organizePageList.classList.remove('hidden');
    organizeApplyBtn.classList.remove('hidden');
    renderOrganizeList();
  }

  organizePickBtn.addEventListener('click', async () => {
    showToast(t('toast.selectingSource'));
    try {
      const picked = await promptAndPickPdfs({ allowMultiple: false });
      if (!picked) {
        return;
      }
      await loadOrganizeFile(picked.bytes, picked.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      goToError(t('error.pdfOpenFailed'), message, 'organize');
    }
  });

  organizeApplyBtn.addEventListener('click', async () => {
    if (!organizeOriginalBytes || organizePageOrder.length === 0) return;

    organizeApplyBtn.disabled = true;
    organizeApplyBtnLabel.classList.add('hidden');
    organizeApplySpinner.classList.remove('hidden');
    try {
      const result = await organizePages(organizeOriginalBytes, organizePageOrder);
      organizeResultPdf = result.organizedPdf;
      organizeStatOriginal.textContent = String(result.originalPageCount);
      organizeStatRemaining.textContent = String(result.pageCount);
      organizeActionStatus.textContent = '';
      organizeFileNameInput.value = `${organizeOriginalName}_edited`;
      organizeSaveState = 'idle';
      organizeSaveBtn.disabled = false;
      organizeSaveBtnLabel.textContent = t('common.save');
      organizeSaveSpinner.classList.add('hidden');
      organizeGoToLocationBtn.classList.add('hidden');
      showScreen('organize-result');
    } catch (error) {
      const message =
        error instanceof BookletError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      goToError(t('error.applyFailed'), message, 'organize');
    } finally {
      organizeApplyBtn.disabled = organizePageOrder.length === 0;
      organizeApplyBtnLabel.classList.remove('hidden');
      organizeApplySpinner.classList.add('hidden');
    }
  });

  organizeFileNameInput.addEventListener('input', () => {
    if (organizeSaveState === 'saved') {
      organizeSaveState = 'idle';
      organizeSaveBtn.disabled = false;
      organizeSaveBtnLabel.textContent = t('common.save');
      organizeGoToLocationBtn.classList.add('hidden');
    }
  });

  organizeSaveBtn.addEventListener('click', async () => {
    if (!organizeResultPdf || organizeSaveState === 'saving') return;

    let filename = organizeFileNameInput.value.trim();
    if (!filename) {
      showToast(t('toast.invalidFileName'));
      return;
    }
    filename = filename.replace(/[/\\:*?"<>|]/g, '_');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }

    const targetPath = `edits/${filename}`;
    if (await pathExists(targetPath)) {
      const overwrite = await showConfirmDialog(t('common.overwriteConfirm', { name: filename }));
      if (!overwrite) return;
    }

    organizeSaveState = 'saving';
    organizeSaveBtn.disabled = true;
    organizeSaveBtnLabel.classList.add('hidden');
    organizeSaveSpinner.classList.remove('hidden');

    try {
      const savedUri = await savePdfPrivately(organizeResultPdf, targetPath);
      await recordOpened({ uri: savedUri, name: filename });
      organizeFileNameInput.value = filename.replace(/\.pdf$/i, '');
      organizeActionStatus.textContent = t('status.organize.saved');
      organizeSaveState = 'saved';
      organizeSaveBtnLabel.textContent = t('common.saved');
      organizeGoToLocationBtn.classList.remove('hidden');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      organizeActionStatus.textContent = t('status.saveFailed', { message });
      organizeSaveState = 'idle';
      organizeSaveBtn.disabled = false;
    } finally {
      organizeSaveBtnLabel.classList.remove('hidden');
      organizeSaveSpinner.classList.add('hidden');
    }
  });

  organizeGoToLocationBtn.addEventListener('click', () => {
    currentFolderPath = 'edits';
    showScreen('files');
  });

  organizeShareBtn.addEventListener('click', async () => {
    if (!organizeResultPdf) return;
    let filename = organizeFileNameInput.value.trim();
    if (!filename) {
      filename = `${organizeOriginalName}_edited`;
    }
    filename = filename.replace(/[/\\:*?"<>|]/g, '_');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }
    try {
      await sharePdf(organizeResultPdf, filename, t('organize.editedPdf'));
      organizeActionStatus.textContent = t('status.shared');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      organizeActionStatus.textContent = t('status.shareFailed', { message });
    }
  });

  organizeNewBtn.addEventListener('click', async () => {
    if (organizeResultPdf !== null && organizeSaveState !== 'saved') {
      if (!(await showConfirmDialog(t('confirm.discardResult')))) return;
    }
    resetOrganizeScreen();
    showScreen('organize');
  });

  function resetRotateScreen(): void {
    rotateOriginalBytes = null;
    if (rotatePdfDoc) void destroyThumbnailDoc(rotatePdfDoc);
    rotatePdfDoc = null;
    rotateAngles = [];
    rotateThumbCache.clear();
    rotateResultPdf = null;
    rotateHero.classList.remove('hidden');
    rotatePickBtn.classList.remove('hidden');
    rotateAllBtn.classList.add('hidden');
    rotatePageList.classList.add('hidden');
    rotateApplyBtn.classList.add('hidden');
    rotatePageList.innerHTML = '';
  }

  function renderRotateList(): void {
    rotateThumbObserver?.disconnect();
    rotatePageList.innerHTML = '';
    rotateApplyBtn.disabled = rotateAngles.length === 0;

    rotateThumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const thumbEl = entry.target as HTMLDivElement;
          rotateThumbObserver?.unobserve(thumbEl);
          const originalIndex = Number(thumbEl.dataset.pageIndex);
          loadRotateThumbnail(thumbEl, originalIndex);
        }
      },
      { root: rotatePageList, rootMargin: '200px' },
    );

    rotateAngles.forEach((angle, originalIndex) => {
      const row = document.createElement('div');
      row.className = 'organize-row';
      row.setAttribute('aria-label', `${t('common.pageLabel', { n: originalIndex + 1 })}, ${angle}°`);
      row.innerHTML = `
        <div class="organize-thumb" data-page-index="${originalIndex}">
          <span class="organize-thumb-placeholder">…</span>
        </div>
        <span class="organize-page-label">${t('common.pageLabel', { n: originalIndex + 1 })}</span>
        <span class="rotate-row-actions">
          <span class="rotate-angle-label">${angle}°</span>
          <button type="button" class="icon-btn-sm" data-action="rotate" aria-label="${t('common.rotate90')}">↻</button>
        </span>
      `;

      const thumbEl = row.querySelector<HTMLDivElement>('.organize-thumb')!;
      thumbEl.style.transform = `rotate(${angle}deg)`;
      const cached = rotateThumbCache.get(originalIndex);
      if (cached) {
        thumbEl.innerHTML = `<img src="${cached}" alt="" />`;
      } else {
        rotateThumbObserver!.observe(thumbEl);
      }

      row.querySelector<HTMLButtonElement>('[data-action="rotate"]')!.addEventListener('click', () => {
        rotateAngles[originalIndex] = (rotateAngles[originalIndex] + 90) % 360;
        renderRotateList();
      });

      rotatePageList.appendChild(row);
    });
  }

  async function loadRotateThumbnail(thumbEl: HTMLDivElement, originalIndex: number): Promise<void> {
    if (!rotatePdfDoc) return;
    try {
      const dataUrl = await renderPageThumbnail(rotatePdfDoc, originalIndex + 1);
      rotateThumbCache.set(originalIndex, dataUrl);
      if (document.contains(thumbEl)) {
        thumbEl.innerHTML = `<img src="${dataUrl}" alt="" />`;
      }
    } catch {
      if (document.contains(thumbEl)) {
        thumbEl.innerHTML = '<span class="organize-thumb-placeholder">?</span>';
      }
    }
  }

  async function loadRotateFile(bytes: Uint8Array, name: string): Promise<void> {
    await validatePdf(bytes);

    rotateOriginalBytes = bytes;
    rotateOriginalName = name.replace(/\.pdf$/i, '');
    // pdf.js's worker transport can transfer/detach the underlying ArrayBuffer
    // of the bytes it's given, so it gets a copy — rotateOriginalBytes must
    // stay intact for rotatePages() later.
    if (rotatePdfDoc) await destroyThumbnailDoc(rotatePdfDoc);
    rotatePdfDoc = await loadPdfForThumbnails(bytes.slice());
    rotateAngles = [];
    for (let i = 1; i <= rotatePdfDoc.numPages; i++) {
      const page = await rotatePdfDoc.getPage(i);
      rotateAngles.push(page.rotate);
    }
    rotateThumbCache.clear();

    rotateHero.classList.add('hidden');
    rotatePickBtn.classList.add('hidden');
    rotateAllBtn.classList.remove('hidden');
    rotatePageList.classList.remove('hidden');
    rotateApplyBtn.classList.remove('hidden');
    renderRotateList();
  }

  rotatePickBtn.addEventListener('click', async () => {
    showToast(t('toast.selectingSource'));
    try {
      const picked = await promptAndPickPdfs({ allowMultiple: false });
      if (!picked) {
        return;
      }
      await loadRotateFile(picked.bytes, picked.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      goToError(t('error.pdfOpenFailed'), message, 'rotate');
    }
  });

  rotateAllBtn.addEventListener('click', () => {
    rotateAngles = rotateAngles.map((angle) => (angle + 90) % 360);
    renderRotateList();
  });

  rotateApplyBtn.addEventListener('click', async () => {
    if (!rotateOriginalBytes || rotateAngles.length === 0) return;

    rotateApplyBtn.disabled = true;
    rotateApplyBtnLabel.classList.add('hidden');
    rotateApplySpinner.classList.remove('hidden');
    try {
      const result = await rotatePages(rotateOriginalBytes, rotateAngles);
      rotateResultPdf = result.rotatedPdf;
      rotateStatPages.textContent = String(result.pageCount);
      rotateActionStatus.textContent = '';
      rotateFileNameInput.value = `${rotateOriginalName}_rotated`;
      rotateSaveState = 'idle';
      rotateSaveBtn.disabled = false;
      rotateSaveBtnLabel.textContent = t('common.save');
      rotateSaveSpinner.classList.add('hidden');
      rotateGoToLocationBtn.classList.add('hidden');
      showScreen('rotate-result');
    } catch (error) {
      const message =
        error instanceof BookletError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      goToError(t('error.applyFailed'), message, 'rotate');
    } finally {
      rotateApplyBtn.disabled = rotateAngles.length === 0;
      rotateApplyBtnLabel.classList.remove('hidden');
      rotateApplySpinner.classList.add('hidden');
    }
  });

  rotateFileNameInput.addEventListener('input', () => {
    if (rotateSaveState === 'saved') {
      rotateSaveState = 'idle';
      rotateSaveBtn.disabled = false;
      rotateSaveBtnLabel.textContent = t('common.save');
      rotateGoToLocationBtn.classList.add('hidden');
    }
  });

  rotateSaveBtn.addEventListener('click', async () => {
    if (!rotateResultPdf || rotateSaveState === 'saving') return;

    let filename = rotateFileNameInput.value.trim();
    if (!filename) {
      showToast(t('toast.invalidFileName'));
      return;
    }
    filename = filename.replace(/[/\\:*?"<>|]/g, '_');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }

    const targetPath = `edits/${filename}`;
    if (await pathExists(targetPath)) {
      const overwrite = await showConfirmDialog(t('common.overwriteConfirm', { name: filename }));
      if (!overwrite) return;
    }

    rotateSaveState = 'saving';
    rotateSaveBtn.disabled = true;
    rotateSaveBtnLabel.classList.add('hidden');
    rotateSaveSpinner.classList.remove('hidden');

    try {
      const savedUri = await savePdfPrivately(rotateResultPdf, targetPath);
      await recordOpened({ uri: savedUri, name: filename });
      rotateFileNameInput.value = filename.replace(/\.pdf$/i, '');
      rotateActionStatus.textContent = t('status.rotate.saved');
      rotateSaveState = 'saved';
      rotateSaveBtnLabel.textContent = t('common.saved');
      rotateGoToLocationBtn.classList.remove('hidden');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rotateActionStatus.textContent = t('status.saveFailed', { message });
      rotateSaveState = 'idle';
      rotateSaveBtn.disabled = false;
    } finally {
      rotateSaveBtnLabel.classList.remove('hidden');
      rotateSaveSpinner.classList.add('hidden');
    }
  });

  rotateGoToLocationBtn.addEventListener('click', () => {
    currentFolderPath = 'edits';
    showScreen('files');
  });

  rotateShareBtn.addEventListener('click', async () => {
    if (!rotateResultPdf) return;
    let filename = rotateFileNameInput.value.trim();
    if (!filename) {
      filename = `${rotateOriginalName}_rotated`;
    }
    filename = filename.replace(/[/\\:*?"<>|]/g, '_');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }
    try {
      await sharePdf(rotateResultPdf, filename, t('rotate.rotatedPdf'));
      rotateActionStatus.textContent = t('status.shared');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rotateActionStatus.textContent = t('status.shareFailed', { message });
    }
  });

  rotateNewBtn.addEventListener('click', async () => {
    if (rotateResultPdf !== null && rotateSaveState !== 'saved') {
      if (!(await showConfirmDialog(t('confirm.discardResult')))) return;
    }
    resetRotateScreen();
    showScreen('rotate');
  });

  function resetPageNumbersScreen(): void {
    pageNumbersOriginalBytes = null;
    if (pageNumbersPdfDoc) void destroyThumbnailDoc(pageNumbersPdfDoc);
    pageNumbersPdfDoc = null;
    pageNumbersOptions = { position: 'bottom-right', format: 'number', startNumber: 1 };
    pageNumbersResultPdf = null;
    pageNumbersHero.classList.remove('hidden');
    pageNumbersPickBtn.classList.remove('hidden');
    pageNumbersPreviewCard.classList.add('hidden');
    pageNumbersSettingsPanel.classList.add('hidden');
    pageNumbersApplyBtn.classList.add('hidden');
    pageNumbersPreviewImg.src = '';
    pageNumbersStartInput.value = '1';
    setActiveSegment(pageNumbersPositionGroup, 'position', 'bottom-right');
    setActiveSegment(pageNumbersFormatGroup, 'format', 'number');
  }

  function setActiveSegment(group: HTMLElement, dataKey: 'position' | 'format' | 'mode' | 'rotate' | 'flip' | 'paper' | 'sig' | 'binding' | 'cover' | 'instr', value: string): void {
    group.querySelectorAll<HTMLButtonElement>('.segmented-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset[dataKey] === value);
    });
  }

  function renderPageNumberPreview(): void {
    if (!pageNumbersPdfDoc) return;
    const lastNumber = pageNumbersOptions.startNumber + pageNumbersPdfDoc.numPages - 1;
    const label = formatPageLabel(
      pageNumbersOptions.format,
      pageNumbersOptions.startNumber,
      lastNumber,
      t('common.pageWord'),
    );
    pageNumbersOverlay.textContent = label;
    pageNumbersOverlay.className = `pagenum-overlay pos-${pageNumbersOptions.position}`;
  }

  async function loadPageNumbersFile(bytes: Uint8Array, name: string): Promise<void> {
    await validatePdf(bytes);

    pageNumbersOriginalBytes = bytes;
    pageNumbersOriginalName = name.replace(/\.pdf$/i, '');
    // pdf.js's worker transport can transfer/detach the underlying ArrayBuffer
    // of the bytes it's given, so it gets a copy — pageNumbersOriginalBytes
    // must stay intact for addPageNumbers() later.
    if (pageNumbersPdfDoc) await destroyThumbnailDoc(pageNumbersPdfDoc);
    pageNumbersPdfDoc = await loadPdfForThumbnails(bytes.slice());
    pageNumbersPreviewImg.src = await renderPageThumbnail(pageNumbersPdfDoc, 1, 220);

    pageNumbersHero.classList.add('hidden');
    pageNumbersPickBtn.classList.add('hidden');
    pageNumbersPreviewCard.classList.remove('hidden');
    pageNumbersSettingsPanel.classList.remove('hidden');
    pageNumbersApplyBtn.classList.remove('hidden');
    pageNumbersApplyBtn.disabled = false;
    renderPageNumberPreview();
  }

  pageNumbersPickBtn.addEventListener('click', async () => {
    showToast(t('toast.selectingSource'));
    try {
      const picked = await promptAndPickPdfs({ allowMultiple: false });
      if (!picked) {
        return;
      }
      await loadPageNumbersFile(picked.bytes, picked.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      goToError(t('error.pdfOpenFailed'), message, 'page-numbers');
    }
  });

  pageNumbersPositionGroup.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
    const position = btn?.dataset.position as PageNumberPosition | undefined;
    if (!position) return;
    pageNumbersOptions.position = position;
    setActiveSegment(pageNumbersPositionGroup, 'position', position);
    renderPageNumberPreview();
  });

  pageNumbersFormatGroup.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
    const format = btn?.dataset.format as PageNumberFormat | undefined;
    if (!format) return;
    pageNumbersOptions.format = format;
    setActiveSegment(pageNumbersFormatGroup, 'format', format);
    renderPageNumberPreview();
  });

  pageNumbersStartInput.addEventListener('input', () => {
    const value = Number(pageNumbersStartInput.value);
    pageNumbersOptions.startNumber = Number.isInteger(value) && value >= 1 ? value : 1;
    renderPageNumberPreview();
  });

  pageNumbersApplyBtn.addEventListener('click', async () => {
    if (!pageNumbersOriginalBytes) return;

    pageNumbersApplyBtn.disabled = true;
    pageNumbersApplyBtnLabel.classList.add('hidden');
    pageNumbersApplySpinner.classList.remove('hidden');
    try {
      const result = await addPageNumbers(pageNumbersOriginalBytes, {
        ...pageNumbersOptions,
        pageWord: t('common.pageWord'),
      });
      pageNumbersResultPdf = result.numberedPdf;
      pageNumbersStatPages.textContent = String(result.pageCount);
      pageNumbersActionStatus.textContent = '';
      pageNumbersFileNameInput.value = `${pageNumbersOriginalName}_numbered`;
      pageNumbersSaveState = 'idle';
      pageNumbersSaveBtn.disabled = false;
      pageNumbersSaveBtnLabel.textContent = t('common.save');
      pageNumbersSaveSpinner.classList.add('hidden');
      pageNumbersGoToLocationBtn.classList.add('hidden');
      showScreen('page-numbers-result');
    } catch (error) {
      const message =
        error instanceof BookletError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      goToError(t('error.applyFailed'), message, 'page-numbers');
    } finally {
      pageNumbersApplyBtn.disabled = false;
      pageNumbersApplyBtnLabel.classList.remove('hidden');
      pageNumbersApplySpinner.classList.add('hidden');
    }
  });

  pageNumbersFileNameInput.addEventListener('input', () => {
    if (pageNumbersSaveState === 'saved') {
      pageNumbersSaveState = 'idle';
      pageNumbersSaveBtn.disabled = false;
      pageNumbersSaveBtnLabel.textContent = t('common.save');
      pageNumbersGoToLocationBtn.classList.add('hidden');
    }
  });

  pageNumbersSaveBtn.addEventListener('click', async () => {
    if (!pageNumbersResultPdf || pageNumbersSaveState === 'saving') return;

    let filename = pageNumbersFileNameInput.value.trim();
    if (!filename) {
      showToast(t('toast.invalidFileName'));
      return;
    }
    filename = filename.replace(/[/\\:*?"<>|]/g, '_');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }

    const targetPath = `edits/${filename}`;
    if (await pathExists(targetPath)) {
      const overwrite = await showConfirmDialog(t('common.overwriteConfirm', { name: filename }));
      if (!overwrite) return;
    }

    pageNumbersSaveState = 'saving';
    pageNumbersSaveBtn.disabled = true;
    pageNumbersSaveBtnLabel.classList.add('hidden');
    pageNumbersSaveSpinner.classList.remove('hidden');

    try {
      const savedUri = await savePdfPrivately(pageNumbersResultPdf, targetPath);
      await recordOpened({ uri: savedUri, name: filename });
      pageNumbersFileNameInput.value = filename.replace(/\.pdf$/i, '');
      pageNumbersActionStatus.textContent = t('status.pageNumbers.saved');
      pageNumbersSaveState = 'saved';
      pageNumbersSaveBtnLabel.textContent = t('common.saved');
      pageNumbersGoToLocationBtn.classList.remove('hidden');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pageNumbersActionStatus.textContent = t('status.saveFailed', { message });
      pageNumbersSaveState = 'idle';
      pageNumbersSaveBtn.disabled = false;
    } finally {
      pageNumbersSaveBtnLabel.classList.remove('hidden');
      pageNumbersSaveSpinner.classList.add('hidden');
    }
  });

  pageNumbersGoToLocationBtn.addEventListener('click', () => {
    currentFolderPath = 'edits';
    showScreen('files');
  });

  pageNumbersShareBtn.addEventListener('click', async () => {
    if (!pageNumbersResultPdf) return;
    let filename = pageNumbersFileNameInput.value.trim();
    if (!filename) {
      filename = `${pageNumbersOriginalName}_numbered`;
    }
    filename = filename.replace(/[/\\:*?"<>|]/g, '_');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }
    try {
      await sharePdf(pageNumbersResultPdf, filename, t('pageNumbers.numberedPdf'));
      pageNumbersActionStatus.textContent = t('status.shared');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pageNumbersActionStatus.textContent = t('status.shareFailed', { message });
    }
  });

  pageNumbersNewBtn.addEventListener('click', async () => {
    if (pageNumbersResultPdf !== null && pageNumbersSaveState !== 'saved') {
      if (!(await showConfirmDialog(t('confirm.discardResult')))) return;
    }
    resetPageNumbersScreen();
    showScreen('page-numbers');
  });

  function resetWatermarkScreen(): void {
    watermarkOriginalBytes = null;
    watermarkMode = 'text';
    watermarkImageBytes = null;
    watermarkImageFormat = 'png';
    watermarkRotateDegrees = 45;
    watermarkResultPdf = null;
    watermarkHero.classList.remove('hidden');
    watermarkPickBtn.classList.remove('hidden');
    watermarkPreviewCard.classList.add('hidden');
    watermarkSettingsPanel.classList.add('hidden');
    watermarkApplyBtn.classList.add('hidden');
    watermarkPreviewImg.src = '';
    watermarkTextInput.value = t('watermark.draftFallback');
    watermarkOpacitySlider.value = '30';
    watermarkOpacityLabel.textContent = t('common.percent', { value: 30 });
    watermarkScaleSlider.value = '50';
    watermarkScaleLabel.textContent = t('common.percent', { value: 50 });
    watermarkImageStatus.textContent = t('watermark.noImageSelected');
    setActiveSegment(watermarkModeGroup, 'mode', 'text');
    setActiveSegment(watermarkRotateGroup, 'rotate', '45');
    watermarkTextCard.classList.remove('hidden');
    watermarkImageCard.classList.add('hidden');
    watermarkScaleCard.classList.add('hidden');
  }

  function renderWatermarkPreview(): void {
    const opacity = Number(watermarkOpacitySlider.value) / 100;
    const transform = `translate(-50%, -50%) rotate(${watermarkRotateDegrees}deg)`;

    if (watermarkMode === 'text') {
      watermarkOverlayText.textContent = watermarkTextInput.value || t('watermark.draftFallback');
      watermarkOverlayText.style.transform = transform;
      watermarkOverlayText.style.opacity = String(opacity);
      watermarkOverlayText.classList.remove('hidden');
      watermarkOverlayImage.classList.add('hidden');
    } else {
      const scale = Number(watermarkScaleSlider.value) / 100;
      watermarkOverlayImage.style.transform = transform;
      watermarkOverlayImage.style.opacity = String(opacity);
      watermarkOverlayImage.style.width = `${scale * 70}%`;
      watermarkOverlayImage.classList.toggle('hidden', !watermarkImageBytes);
      watermarkOverlayText.classList.add('hidden');
    }
  }

  async function loadWatermarkFile(bytes: Uint8Array, name: string): Promise<void> {
    await validatePdf(bytes);

    watermarkOriginalBytes = bytes;
    watermarkOriginalName = name.replace(/\.pdf$/i, '');
    // pdf.js's worker transport can transfer/detach the underlying ArrayBuffer
    // of the bytes it's given, so it gets a copy — watermarkOriginalBytes
    // must stay intact for addWatermark() later.
    const pdfDoc = await loadPdfForThumbnails(bytes.slice());
    watermarkPreviewImg.src = await renderPageThumbnail(pdfDoc, 1, 220);
    await destroyThumbnailDoc(pdfDoc);

    watermarkHero.classList.add('hidden');
    watermarkPickBtn.classList.add('hidden');
    watermarkPreviewCard.classList.remove('hidden');
    watermarkSettingsPanel.classList.remove('hidden');
    watermarkApplyBtn.classList.remove('hidden');
    watermarkApplyBtn.disabled = false;
    renderWatermarkPreview();
  }

  watermarkPickBtn.addEventListener('click', async () => {
    showToast(t('toast.selectingSource'));
    try {
      const picked = await promptAndPickPdfs({ allowMultiple: false });
      if (!picked) {
        return;
      }
      await loadWatermarkFile(picked.bytes, picked.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      goToError(t('error.pdfOpenFailed'), message, 'watermark');
    }
  });

  watermarkModeGroup.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
    const mode = btn?.dataset.mode as 'text' | 'image' | undefined;
    if (!mode) return;
    watermarkMode = mode;
    setActiveSegment(watermarkModeGroup, 'mode', mode);
    watermarkTextCard.classList.toggle('hidden', mode !== 'text');
    watermarkImageCard.classList.toggle('hidden', mode !== 'image');
    watermarkScaleCard.classList.toggle('hidden', mode !== 'image');
    renderWatermarkPreview();
  });

  watermarkImagePickBtn.addEventListener('click', async () => {
    try {
      const picked = await pickImage();
      if (!picked) return;

      watermarkImageBytes = picked.bytes;
      watermarkImageFormat = /\.jpe?g$/i.test(picked.name) ? 'jpg' : 'png';
      watermarkImageStatus.textContent = t('watermark.imageSelected', { name: picked.name });
      watermarkOverlayImage.src = URL.createObjectURL(new Blob([new Uint8Array(picked.bytes)]));
      renderWatermarkPreview();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      watermarkImageStatus.textContent = t('watermark.imageSelectError', { message });
    }
  });

  watermarkRotateGroup.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.segmented-btn');
    const rotate = btn?.dataset.rotate;
    if (rotate === undefined) return;
    watermarkRotateDegrees = Number(rotate);
    setActiveSegment(watermarkRotateGroup, 'rotate', rotate);
    renderWatermarkPreview();
  });

  watermarkOpacitySlider.addEventListener('input', () => {
    watermarkOpacityLabel.textContent = t('common.percent', { value: watermarkOpacitySlider.value });
    renderWatermarkPreview();
  });

  watermarkScaleSlider.addEventListener('input', () => {
    watermarkScaleLabel.textContent = t('common.percent', { value: watermarkScaleSlider.value });
    renderWatermarkPreview();
  });

  watermarkTextInput.addEventListener('input', () => renderWatermarkPreview());

  watermarkApplyBtn.addEventListener('click', async () => {
    if (!watermarkOriginalBytes) return;

    const opacity = Number(watermarkOpacitySlider.value) / 100;
    let options: WatermarkOptions;
    if (watermarkMode === 'text') {
      options = { type: 'text', text: watermarkTextInput.value, opacity, rotateDegrees: watermarkRotateDegrees };
    } else {
      if (!watermarkImageBytes) {
        goToError(t('error.noImageSelectedTitle'), t('error.noImageSelectedMessage'), 'watermark');
        return;
      }
      options = {
        type: 'image',
        imageBytes: watermarkImageBytes,
        imageFormat: watermarkImageFormat,
        opacity,
        scale: Number(watermarkScaleSlider.value) / 100,
        rotateDegrees: watermarkRotateDegrees,
      };
    }

    watermarkApplyBtn.disabled = true;
    watermarkApplyBtnLabel.classList.add('hidden');
    watermarkApplySpinner.classList.remove('hidden');
    try {
      const result = await addWatermark(watermarkOriginalBytes, options);
      watermarkResultPdf = result.watermarkedPdf;
      watermarkStatPages.textContent = String(result.pageCount);
      watermarkActionStatus.textContent = '';
      watermarkFileNameInput.value = `${watermarkOriginalName}_watermarked`;
      watermarkSaveState = 'idle';
      watermarkSaveBtn.disabled = false;
      watermarkSaveBtnLabel.textContent = t('common.save');
      watermarkSaveSpinner.classList.add('hidden');
      watermarkGoToLocationBtn.classList.add('hidden');
      showScreen('watermark-result');
    } catch (error) {
      const message =
        error instanceof BookletError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      goToError(t('error.applyFailed'), message, 'watermark');
    } finally {
      watermarkApplyBtn.disabled = false;
      watermarkApplyBtnLabel.classList.remove('hidden');
      watermarkApplySpinner.classList.add('hidden');
    }
  });

  watermarkFileNameInput.addEventListener('input', () => {
    if (watermarkSaveState === 'saved') {
      watermarkSaveState = 'idle';
      watermarkSaveBtn.disabled = false;
      watermarkSaveBtnLabel.textContent = t('common.save');
      watermarkGoToLocationBtn.classList.add('hidden');
    }
  });

  watermarkSaveBtn.addEventListener('click', async () => {
    if (!watermarkResultPdf || watermarkSaveState === 'saving') return;

    let filename = watermarkFileNameInput.value.trim();
    if (!filename) {
      showToast(t('toast.invalidFileName'));
      return;
    }
    filename = filename.replace(/[/\\:*?"<>|]/g, '_');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }

    const targetPath = `edits/${filename}`;
    if (await pathExists(targetPath)) {
      const overwrite = await showConfirmDialog(t('common.overwriteConfirm', { name: filename }));
      if (!overwrite) return;
    }

    watermarkSaveState = 'saving';
    watermarkSaveBtn.disabled = true;
    watermarkSaveBtnLabel.classList.add('hidden');
    watermarkSaveSpinner.classList.remove('hidden');

    try {
      const savedUri = await savePdfPrivately(watermarkResultPdf, targetPath);
      await recordOpened({ uri: savedUri, name: filename });
      watermarkFileNameInput.value = filename.replace(/\.pdf$/i, '');
      watermarkActionStatus.textContent = t('status.watermark.saved');
      watermarkSaveState = 'saved';
      watermarkSaveBtnLabel.textContent = t('common.saved');
      watermarkGoToLocationBtn.classList.remove('hidden');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      watermarkActionStatus.textContent = t('status.saveFailed', { message });
      watermarkSaveState = 'idle';
      watermarkSaveBtn.disabled = false;
    } finally {
      watermarkSaveBtnLabel.classList.remove('hidden');
      watermarkSaveSpinner.classList.add('hidden');
    }
  });

  watermarkGoToLocationBtn.addEventListener('click', () => {
    currentFolderPath = 'edits';
    showScreen('files');
  });

  watermarkShareBtn.addEventListener('click', async () => {
    if (!watermarkResultPdf) return;
    let filename = watermarkFileNameInput.value.trim();
    if (!filename) {
      filename = `${watermarkOriginalName}_watermarked`;
    }
    filename = filename.replace(/[/\\:*?"<>|]/g, '_');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }
    try {
      await sharePdf(watermarkResultPdf, filename, t('watermark.watermarkedPdf'));
      watermarkActionStatus.textContent = t('status.shared');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      watermarkActionStatus.textContent = t('status.shareFailed', { message });
    }
  });

  watermarkNewBtn.addEventListener('click', async () => {
    if (watermarkResultPdf !== null && watermarkSaveState !== 'saved') {
      if (!(await showConfirmDialog(t('confirm.discardResult')))) return;
    }
    resetWatermarkScreen();
    showScreen('watermark');
  });

  // --- Image to PDF Screen Logic ---
  interface ImageItem {
    id: string;
    name: string;
    bytes: Uint8Array;
    format: 'png' | 'jpg';
    url: string;
  }

  let selectedImages: ImageItem[] = [];

  function clearImageToPdfState(): void {
    selectedImages.forEach((img) => URL.revokeObjectURL(img.url));
    selectedImages = [];
    renderImageGrid();
  }

  const imgCameraBtn = byId<HTMLButtonElement>('imgCameraBtn');
  const imgGalleryInput = byId<HTMLInputElement>('imgGalleryInput');
  const imgListEmptyHint = byId<HTMLElement>('imgListEmptyHint');
  const imageGrid = byId<HTMLElement>('imageGrid');
  const imgGenerateBtn = byId<HTMLButtonElement>('imgGenerateBtn');
  const imgGenerateBtnLabel = byId<HTMLSpanElement>('imgGenerateBtnLabel');
  const imgGenerateSpinner = byId<HTMLSpanElement>('imgGenerateSpinner');

  function renderImageGrid(): void {
    imageGrid.innerHTML = '';
    const hasImages = selectedImages.length > 0;
    imgListEmptyHint.classList.toggle('hidden', hasImages);
    imgGenerateBtn.classList.toggle('hidden', !hasImages);
    imgGenerateBtn.disabled = !hasImages;

    selectedImages.forEach((img, index) => {
      const card = document.createElement('div');
      card.className = 'image-card';

      const badge = document.createElement('span');
      badge.className = 'image-card-badge';
      badge.textContent = String(index + 1);

      const thumb = document.createElement('div');
      thumb.className = 'image-card-thumb';
      const imgEl = document.createElement('img');
      imgEl.src = img.url;
      imgEl.alt = img.name;
      thumb.appendChild(imgEl);

      const actions = document.createElement('div');
      actions.className = 'image-card-actions';

      // Move Up
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'icon-btn-sm';
      upBtn.innerHTML = '▲';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => {
        const temp = selectedImages[index];
        selectedImages[index] = selectedImages[index - 1];
        selectedImages[index - 1] = temp;
        renderImageGrid();
      });

      // Move Down
      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'icon-btn-sm';
      downBtn.innerHTML = '▼';
      downBtn.disabled = index === selectedImages.length - 1;
      downBtn.addEventListener('click', () => {
        const temp = selectedImages[index];
        selectedImages[index] = selectedImages[index + 1];
        selectedImages[index + 1] = temp;
        renderImageGrid();
      });

      // Delete
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-btn-sm delete-btn';
      deleteBtn.innerHTML = '✕';
      deleteBtn.addEventListener('click', () => {
        URL.revokeObjectURL(img.url);
        selectedImages = selectedImages.filter((_, i) => i !== index);
        renderImageGrid();
      });

      actions.append(upBtn, downBtn, deleteBtn);
      card.append(badge, thumb, actions);
      imageGrid.appendChild(card);
    });
  }

  async function handleImageFiles(files: FileList): Promise<void> {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const format = /\.png$/i.test(file.name) ? 'png' : 'jpg';
      startCropFlow(bytes, file.name, format);
    }
  }

  imgCameraBtn.addEventListener('click', async () => {
    try {
      let status = await Camera.checkPermissions();
      if (status.camera !== 'granted') {
        status = await Camera.requestPermissions({ permissions: ['camera'] });
      }

      if (status.camera !== 'granted') {
        showToast(t('toast.cameraPermissionDenied'));
        return;
      }

      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
      });

      if (!photo.webPath) {
        throw new Error(t('error.photoPathFailed'));
      }

      const response = await fetch(photo.webPath);
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const format = photo.format === 'png' ? 'png' : 'jpg';
      const name = `camera_shot_${Date.now()}.${format}`;

      startCropFlow(bytes, name, format);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('cancelled') || msg.includes('cancel')) {
        return;
      }
      showToast(t('toast.cameraError', { message: msg }));
    }
  });

  imgGalleryInput.addEventListener('change', async () => {
    if (imgGalleryInput.files) {
      await handleImageFiles(imgGalleryInput.files);
      imgGalleryInput.value = '';
    }
  });

  imgGenerateBtn.addEventListener('click', async () => {
    imgGenerateBtn.disabled = true;
    imgGenerateBtnLabel.classList.add('hidden');
    imgGenerateSpinner.classList.remove('hidden');
    try {
      const input = selectedImages.map((img) => ({
        bytes: img.bytes,
        format: img.format,
      }));
      const pdfBytes = await imagesToPdf(input);

      // Auto-save privately inside Bindery data folder
      const dateStr = new Date().toISOString().slice(0, 10);
      const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
      const filename = `Scan_${dateStr}_${timeStr}.pdf`;
      const privateUri = await savePdfPrivately(pdfBytes, `scans/${filename}`);
      await recordOpened({ uri: privateUri, name: filename });

      await openReaderWithBytes(pdfBytes, filename, privateUri, 'image-to-pdf');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      goToError(t('error.pdfCreateFailed'), message, 'image-to-pdf');
    } finally {
      imgGenerateBtn.disabled = false;
      imgGenerateBtnLabel.classList.remove('hidden');
      imgGenerateSpinner.classList.add('hidden');
    }
  });

  // --- Image Cropping & Perspective Correction Logic ---
  let cropQueue: { bytes: Uint8Array; name: string; format: 'png' | 'jpg' }[] = [];
  let currentCropItem: { bytes: Uint8Array; name: string; format: 'png' | 'jpg' } | null = null;
  let cropImageWidth = 0;
  let cropImageHeight = 0;
  let cropPoints: Point[] = []; // Top-Left, Top-Right, Bottom-Left, Bottom-Right in relative image coordinates [0, 1]

  const cropCancelBtn = byId<HTMLButtonElement>('cropCancelBtn');
  const cropResetBtn = byId<HTMLButtonElement>('cropResetBtn');
  const cropApplyBtn = byId<HTMLButtonElement>('cropApplyBtn');
  const cropSourceImg = byId<HTMLImageElement>('cropSourceImg');
  const cropSvg = byId<SVGElement>('cropSvg');
  const cropPolygon = byId<SVGPolygonElement>('cropPolygon');
  const cropLoupe = byId<HTMLDivElement>('cropLoupe');
  const cropLoupeCanvas = byId<HTMLCanvasElement>('cropLoupeCanvas');
  const cropLoupeCtx = cropLoupeCanvas.getContext('2d');

  // SVG lines
  const line01 = byId<SVGLineElement>('line01');
  const line13 = byId<SVGLineElement>('line13');
  const line32 = byId<SVGLineElement>('line32');
  const line20 = byId<SVGLineElement>('line20');

  // Handles
  const handles = [
    byId<SVGCircleElement>('handle0'),
    byId<SVGCircleElement>('handle1'),
    byId<SVGCircleElement>('handle2'),
    byId<SVGCircleElement>('handle3'),
  ];

  function startCropFlow(bytes: Uint8Array, name: string, format: 'png' | 'jpg'): void {
    cropQueue.push({ bytes, name, format });
    if (cropQueue.length === 1) {
      void processNextCrop();
    }
  }

  async function processNextCrop(): Promise<void> {
    if (cropQueue.length === 0) {
      currentCropItem = null;
      showScreen('image-to-pdf');
      return;
    }

    currentCropItem = cropQueue[0];
    const blob = new Blob([currentCropItem.bytes as any], { type: currentCropItem.format === 'png' ? 'image/png' : 'image/jpeg' });
    const url = URL.createObjectURL(blob);

    cropSourceImg.src = url;
    showScreen('crop');

    cropSourceImg.onload = () => {
      cropImageWidth = cropSourceImg.naturalWidth;
      cropImageHeight = cropSourceImg.naturalHeight;

      // Position crop handles in a default rectangle (%15 margins from edges)
      cropPoints = [
        { x: 0.15, y: 0.15 }, // Top-Left (index 0)
        { x: 0.85, y: 0.15 }, // Top-Right (index 1)
        { x: 0.15, y: 0.85 }, // Bottom-Left (index 2)
        { x: 0.85, y: 0.85 }, // Bottom-Right (index 3)
      ];

      updateCropUI();
      // Setup scaling of Loupe Canvas
      cropLoupeCanvas.width = 120;
      cropLoupeCanvas.height = 120;
    };
  }

  function getImageRect(): { left: number; top: number; width: number; height: number } {
    const rect = cropSourceImg.getBoundingClientRect();
    const containerRect = cropSourceImg.parentElement!.getBoundingClientRect();

    const imgRatio = cropImageWidth / cropImageHeight;
    const containerRatio = rect.width / rect.height;

    let displayWidth = rect.width;
    let displayHeight = rect.height;

    if (imgRatio > containerRatio) {
      displayHeight = rect.width / imgRatio;
    } else {
      displayWidth = rect.height * imgRatio;
    }

    const left = rect.left - containerRect.left + (rect.width - displayWidth) / 2;
    const top = rect.top - containerRect.top + (rect.height - displayHeight) / 2;

    return {
      left,
      top,
      width: displayWidth,
      height: displayHeight,
    };
  }

  function updateCropUI(): void {
    const rect = getImageRect();
    
    // Position the SVG overlay container exactly over the image
    cropSvg.style.left = `${rect.left}px`;
    cropSvg.style.top = `${rect.top}px`;
    cropSvg.style.width = `${rect.width}px`;
    cropSvg.style.height = `${rect.height}px`;

    // Map relative coordinates to rendered pixel coordinates
    const pxPoints = cropPoints.map((pt) => ({
      x: pt.x * rect.width,
      y: pt.y * rect.height,
    }));

    // Update handles
    pxPoints.forEach((pt, index) => {
      handles[index].setAttribute('cx', String(pt.x));
      handles[index].setAttribute('cy', String(pt.y));
    });

    // Update polygon points
    const polyPoints = [
      pxPoints[0], // TL
      pxPoints[1], // TR
      pxPoints[3], // BR
      pxPoints[2], // BL
    ];
    const pointsStr = polyPoints.map((p) => `${p.x},${p.y}`).join(' ');
    cropPolygon.setAttribute('points', pointsStr);

    // Update lines
    line01.setAttribute('x1', String(pxPoints[0].x));
    line01.setAttribute('y1', String(pxPoints[0].y));
    line01.setAttribute('x2', String(pxPoints[1].x));
    line01.setAttribute('y2', String(pxPoints[1].y));

    line13.setAttribute('x1', String(pxPoints[1].x));
    line13.setAttribute('y1', String(pxPoints[1].y));
    line13.setAttribute('x2', String(pxPoints[3].x));
    line13.setAttribute('y2', String(pxPoints[3].y));

    line32.setAttribute('x1', String(pxPoints[3].x));
    line32.setAttribute('y1', String(pxPoints[3].y));
    line32.setAttribute('x2', String(pxPoints[2].x));
    line32.setAttribute('y2', String(pxPoints[2].y));

    line20.setAttribute('x1', String(pxPoints[2].x));
    line20.setAttribute('y1', String(pxPoints[2].y));
    line20.setAttribute('x2', String(pxPoints[0].x));
    line20.setAttribute('y2', String(pxPoints[0].y));
  }

  function updateLoupe(e: PointerEvent): void {
    if (activeHandleIndex === null || !cropLoupeCtx) return;

    // Position loupe element relative to the container
    const containerRect = cropSourceImg.parentElement!.getBoundingClientRect();
    const x = e.clientX - containerRect.left;
    const y = e.clientY - containerRect.top;

    cropLoupe.style.left = `${x}px`;
    cropLoupe.style.top = `${y}px`;

    // Coordinates on original full-resolution image
    const pt = cropPoints[activeHandleIndex];
    const origX = pt.x * cropImageWidth;
    const origY = pt.y * cropImageHeight;

    // Clear loupe canvas
    cropLoupeCtx.fillStyle = '#000';
    cropLoupeCtx.fillRect(0, 0, 120, 120);

    // Draw magnified image slice
    const sourceSize = 60;
    const destSize = 120;
    cropLoupeCtx.drawImage(
      cropSourceImg,
      origX - sourceSize / 2,
      origY - sourceSize / 2,
      sourceSize,
      sourceSize,
      0,
      0,
      destSize,
      destSize
    );

    // Draw crosshair
    cropLoupeCtx.strokeStyle = 'red';
    cropLoupeCtx.lineWidth = 1.5;
    cropLoupeCtx.beginPath();
    cropLoupeCtx.moveTo(40, 60);
    cropLoupeCtx.lineTo(80, 60);
    cropLoupeCtx.moveTo(60, 40);
    cropLoupeCtx.lineTo(60, 80);
    cropLoupeCtx.stroke();
  }

  let activeHandleIndex: number | null = null;

  handles.forEach((handle, index) => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      activeHandleIndex = index;

      cropLoupe.classList.remove('hidden');
      updateLoupe(e);
    });

    handle.addEventListener('pointermove', (e) => {
      if (activeHandleIndex !== index) return;
      e.preventDefault();

      const rect = getImageRect();
      const containerRect = cropSourceImg.parentElement!.getBoundingClientRect();

      const clientX = e.clientX - containerRect.left - rect.left;
      const clientY = e.clientY - containerRect.top - rect.top;

      const rx = Math.max(0, Math.min(1, clientX / rect.width));
      const ry = Math.max(0, Math.min(1, clientY / rect.height));

      cropPoints[index] = { x: rx, y: ry };
      updateCropUI();
      updateLoupe(e);
    });

    const handleRelease = (e: PointerEvent) => {
      if (activeHandleIndex === index) {
        handle.releasePointerCapture(e.pointerId);
        activeHandleIndex = null;
        cropLoupe.classList.add('hidden');
      }
    };

    handle.addEventListener('pointerup', handleRelease);
    handle.addEventListener('pointercancel', handleRelease);
  });

  cropCancelBtn.addEventListener('click', () => {
    if (cropSourceImg.src) {
      URL.revokeObjectURL(cropSourceImg.src);
    }
    cropQueue.shift();
    void processNextCrop();
  });

  cropResetBtn.addEventListener('click', () => {
    cropPoints = [
      { x: 0.15, y: 0.15 },
      { x: 0.85, y: 0.15 },
      { x: 0.15, y: 0.85 },
      { x: 0.85, y: 0.85 },
    ];
    updateCropUI();
  });

  cropApplyBtn.addEventListener('click', async () => {
    if (!currentCropItem) return;
    cropApplyBtn.disabled = true;

    try {
      const pixelCorners = cropPoints.map((pt) => ({
        x: pt.x * cropImageWidth,
        y: pt.y * cropImageHeight,
      }));

      const warpedBytes = await warpPerspective(
        currentCropItem.bytes,
        pixelCorners,
        1240,
        1754
      );

      const url = URL.createObjectURL(new Blob([warpedBytes as any], { type: 'image/jpeg' }));
      selectedImages.push({
        id: Math.random().toString(36).substring(2, 9),
        name: currentCropItem.name,
        bytes: warpedBytes,
        format: 'jpg',
        url,
      });

      renderImageGrid();

      URL.revokeObjectURL(cropSourceImg.src);
      
      cropQueue.shift();
      void processNextCrop();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      goToError(t('error.perspectiveFailed'), msg, 'crop');
    } finally {
      cropApplyBtn.disabled = false;
    }
  });

  let readerResizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    if (getCurrentScreenId() === 'crop') {
      updateCropUI();
    }
    // Orientation changes surface as resizes in the Capacitor WebView; the
    // relayout also runs while the fullscreen overlay is up so the list
    // behind it stays consistent (the overlay has its own orientation handler).
    if (getCurrentScreenId() === 'reader' && readerDoc) {
      if (readerResizeTimer) clearTimeout(readerResizeTimer);
      readerResizeTimer = setTimeout(() => {
        readerResizeTimer = undefined;
        if (getCurrentScreenId() !== 'reader' || !readerDoc) return;
        const newBase = readerScroll.clientWidth;
        if (newBase <= 0) return;
        // Only a genuine width change (orientation/window resize) needs a
        // relayout. The soft keyboard opening/closing fires a height-only
        // resize; relaying out there would re-anchor scroll to the top of the
        // viewport and hijack an in-flight smooth scroll (e.g. Go-to-Page
        // landing on the wrong page as the keyboard dismisses).
        if (Math.abs(newBase - readerBaseWidthPx) < 0.5) return;
        readerBaseWidthPx = newBase;
        // Anchor the top of the currently-read position (page + in-page
        // fraction survive the width change exactly).
        relayoutReader({ viewportX: readerScroll.clientWidth / 2, viewportY: 0 });
      }, 200);
    }
  });


  async function closeReaderDocument(): Promise<void> {
    readerObserver?.disconnect();
    readerObserver = null;
    readerRendered.clear();
    readerPageList.innerHTML = '';
    readerBytes = null;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    readerSearchPanel.classList.add('hidden');
    readerSearchBtn.classList.remove('search-active');
    readerSearchInput.value = '';
    searchMatches = [];
    searchCurrentIndex = -1;
    searchActiveQuery = '';
    updateSearchUI();
    resetReaderNavState();
    if (readerDoc) {
      const doc = readerDoc;
      readerDoc = null;
      await doc.destroy();
    }
  }

  function updateReaderPageIndicator(): void {
    if (!readerDoc) return;
    const current = Math.min(readerDoc.proxy.numPages, readerPageAtScrollTop(readerScroll.scrollTop));
    readerPageIndicator.textContent = `${current} / ${readerDoc.proxy.numPages}`;

    if (readerLastPageSaveTimer) clearTimeout(readerLastPageSaveTimer);
    readerLastPageSaveTimer = setTimeout(() => {
      void updateLastPage(readerName, current);
    }, 800);
  }

  function scheduleReaderPageIndicatorUpdate(): void {
    if (readerIndicatorRaf) return;
    readerIndicatorRaf = requestAnimationFrame(() => {
      readerIndicatorRaf = 0;
      updateReaderPageIndicator();
    });
  }

  // ── Reader chrome auto-hide + edge scrubber ────────────────────────────────

  let readerChromeHidden = false;
  let readerLastScrollTop = 0;
  let isScrubberDragging = false;
  let scrubberHideTimer: ReturnType<typeof setTimeout> | undefined;
  const READER_SCROLL_JITTER_PX = 12;

  function setReaderChromeHidden(hidden: boolean): void {
    if (readerChromeHidden === hidden) return;
    readerChromeHidden = hidden;
    appShell.classList.toggle('reader-chrome-hidden', hidden);
  }

  function updateScrubberThumb(): void {
    const max = readerScroll.scrollHeight - readerScroll.clientHeight;
    if (max <= 0) return;
    const trackH = readerScrubber.clientHeight - readerScrubberThumb.offsetHeight;
    readerScrubberThumb.style.top = `${(readerScroll.scrollTop / max) * trackH}px`;
  }

  function showScrubberTemporarily(): void {
    if (readerScrubber.classList.contains('hidden')) return;
    readerScrubber.classList.add('is-visible');
    if (scrubberHideTimer) clearTimeout(scrubberHideTimer);
    scrubberHideTimer = setTimeout(() => {
      if (!isScrubberDragging) readerScrubber.classList.remove('is-visible');
    }, 1500);
  }

  readerScroll.addEventListener('scroll', () => {
    // While pinching the scroll position is locked — snap back any movement
    // (overflow:hidden blocks touch panning; this catches everything else)
    // and skip indicator/scrubber/auto-hide work entirely.
    if (isPinching) {
      if (readerScroll.scrollTop !== pinchLockScrollTop) readerScroll.scrollTop = pinchLockScrollTop;
      if (readerScroll.scrollLeft !== pinchLockScrollLeft) readerScroll.scrollLeft = pinchLockScrollLeft;
      readerLastScrollTop = pinchLockScrollTop;
      return;
    }
    scheduleReaderPageIndicatorUpdate();
    updateScrubberThumb();
    showScrubberTemporarily();

    const top = readerScroll.scrollTop;
    if (isScrubberDragging) {
      readerLastScrollTop = top;
      return;
    }
    // Chrome must stay visible while searching, and always at the very top.
    if (!readerSearchPanel.classList.contains('hidden')) {
      setReaderChromeHidden(false);
      readerLastScrollTop = top;
      return;
    }
    if (top <= 0) {
      setReaderChromeHidden(false);
      readerLastScrollTop = 0;
      return;
    }
    const delta = top - readerLastScrollTop;
    if (Math.abs(delta) > READER_SCROLL_JITTER_PX) {
      setReaderChromeHidden(delta > 0);
      readerLastScrollTop = top;
    }
  });

  // ── Zoom (double-tap + pinch) ──────────────────────────────────────────────

  const activePinchPointers = new Map<number, { x: number; y: number }>();
  let isPinching = false;
  let pinchStartDist = 0;
  let pinchCenter = { x: 0, y: 0 }; // relative to readerScroll's box
  let pinchPreviewScale = 1;
  let pinchLockScrollTop = 0;
  let pinchLockScrollLeft = 0;
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let pendingChromeToggle: ReturnType<typeof setTimeout> | undefined;

  function resetReaderZoomState(): void {
    readerZoom = 1;
    readerPageList.style.transform = '';
    readerPageList.style.transformOrigin = '';
    readerScroll.classList.remove('is-zoomed', 'is-pinching');
    activePinchPointers.clear();
    isPinching = false;
    pinchPreviewScale = 1;
    lastTapTime = 0;
    if (pendingChromeToggle) {
      clearTimeout(pendingChromeToggle);
      pendingChromeToggle = undefined;
    }
  }

  function setReaderZoom(zoom: number, focus: { viewportX: number; viewportY: number }): void {
    const clamped = Math.min(READER_ZOOM_MAX, Math.max(READER_ZOOM_MIN, zoom));
    if (clamped === readerZoom) return;
    readerZoom = clamped;
    relayoutReader(focus);
  }

  readerScroll.addEventListener('click', (e) => {
    if (isPinching) return;
    if (window.getSelection()?.toString()) return;
    if (!readerSearchPanel.classList.contains('hidden')) return;
    const target = e.target as HTMLElement;
    if (target !== readerScroll && !target.closest('.reader-page-list')) return;

    const now = Date.now();
    const isDoubleTap =
      now - lastTapTime <= 300 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) <= 30;
    if (isDoubleTap) {
      lastTapTime = 0;
      if (pendingChromeToggle) {
        clearTimeout(pendingChromeToggle);
        pendingChromeToggle = undefined;
      }
      const rect = readerScroll.getBoundingClientRect();
      setReaderZoom(readerZoom === 1 ? 2 : 1, {
        viewportX: e.clientX - rect.left,
        viewportY: e.clientY - rect.top,
      });
      return;
    }
    lastTapTime = now;
    lastTapX = e.clientX;
    lastTapY = e.clientY;
    if (pendingChromeToggle) clearTimeout(pendingChromeToggle);
    // Hold the chrome toggle back for the double-tap window so zooming
    // doesn't also flip the bars.
    pendingChromeToggle = setTimeout(() => {
      pendingChromeToggle = undefined;
      setReaderChromeHidden(!readerChromeHidden);
    }, 300);
  });

  function pinchDistAndCenter(): { dist: number; x: number; y: number } {
    const [a, b] = [...activePinchPointers.values()];
    const rect = readerScroll.getBoundingClientRect();
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      x: (a.x + b.x) / 2 - rect.left,
      y: (a.y + b.y) / 2 - rect.top,
    };
  }

  function endPinch(): void {
    if (!isPinching) return;
    isPinching = false;
    readerScroll.classList.remove('is-pinching');
    readerPageList.style.transform = '';
    readerPageList.style.transformOrigin = '';
    const target = readerZoom * pinchPreviewScale;
    pinchPreviewScale = 1;
    setReaderZoom(target, { viewportX: pinchCenter.x, viewportY: pinchCenter.y });
    // Suppress the click the browser may synthesize right after the gesture.
    lastTapTime = 0;
  }

  readerScroll.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    activePinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePinchPointers.size === 2 && !isPinching && readerDoc) {
      isPinching = true;
      pinchLockScrollTop = readerScroll.scrollTop;
      pinchLockScrollLeft = readerScroll.scrollLeft;
      readerScroll.classList.add('is-pinching');
      const { dist, x, y } = pinchDistAndCenter();
      pinchStartDist = Math.max(dist, 1);
      pinchCenter = { x, y };
      pinchPreviewScale = 1;
      // Freeze the transform origin now, while the list is untransformed.
      // Recomputing it per-move from getBoundingClientRect() reads the
      // already-scaled rect — a feedback loop that drags the content away
      // from under the fingers.
      const listRect = readerPageList.getBoundingClientRect();
      const scrollRect = readerScroll.getBoundingClientRect();
      readerPageList.style.transformOrigin = `${x + scrollRect.left - listRect.left}px ${y + scrollRect.top - listRect.top}px`;
      if (pendingChromeToggle) {
        clearTimeout(pendingChromeToggle);
        pendingChromeToggle = undefined;
      }
    }
  });

  readerScroll.addEventListener('pointermove', (e) => {
    if (!activePinchPointers.has(e.pointerId)) return;
    activePinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!isPinching || activePinchPointers.size < 2) return;
    const { dist } = pinchDistAndCenter();
    const k = dist / pinchStartDist;
    // Cheap visual preview only — the sharp re-render happens once on release.
    pinchPreviewScale = Math.min(
      READER_ZOOM_MAX / readerZoom,
      Math.max(READER_ZOOM_MIN / readerZoom / 1.2, k),
    );
    // Origin was frozen at pinch start; only the scale changes per move.
    readerPageList.style.transform = `scale(${pinchPreviewScale})`;
  });

  const onPinchPointerEnd = (e: PointerEvent): void => {
    if (!activePinchPointers.delete(e.pointerId)) return;
    if (isPinching && activePinchPointers.size < 2) endPinch();
  };
  readerScroll.addEventListener('pointerup', onPinchPointerEnd);
  readerScroll.addEventListener('pointercancel', onPinchPointerEnd);

  // touch-action can't change mid-gesture, so additionally block the
  // browser's own two-finger handling while a pinch is being tracked.
  readerScroll.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length >= 2) e.preventDefault();
    },
    { passive: false },
  );

  readerScrubberThumb.addEventListener('pointerdown', (e) => {
    if (!readerDoc) return;
    isScrubberDragging = true;
    try {
      readerScrubberThumb.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released (or synthetic event) — drag still works
      // while the pointer stays over the thumb.
    }
    readerScrubber.classList.add('is-visible');
    readerScrubberBubble.classList.remove('hidden');
    e.preventDefault();
  });

  readerScrubberThumb.addEventListener('pointermove', (e) => {
    if (!isScrubberDragging || !readerDoc) return;
    const rect = readerScrubber.getBoundingClientRect();
    const thumbH = readerScrubberThumb.offsetHeight;
    const trackH = rect.height - thumbH;
    const y = Math.min(Math.max(e.clientY - rect.top - thumbH / 2, 0), Math.max(trackH, 0));
    const max = readerScroll.scrollHeight - readerScroll.clientHeight;
    // Instant, not smooth: the thumb must track the finger 1:1.
    readerScroll.scrollTop = trackH > 0 ? (y / trackH) * max : 0;
    readerScrubberThumb.style.top = `${y}px`;
    readerScrubberBubble.textContent =
      `${readerPageAtScrollTop(readerScroll.scrollTop)} / ${readerDoc.proxy.numPages}`;
    readerScrubberBubble.style.top = `${y + thumbH / 2}px`;
  });

  const endScrubberDrag = (): void => {
    if (!isScrubberDragging) return;
    isScrubberDragging = false;
    readerScrubberBubble.classList.add('hidden');
    showScrubberTemporarily();
  };
  readerScrubberThumb.addEventListener('pointerup', endScrubberDrag);
  readerScrubberThumb.addEventListener('pointercancel', endScrubberDrag);

  // ── Go to page ─────────────────────────────────────────────────────────────

  readerPageIndicator.addEventListener('click', () => {
    if (!readerDoc) return;
    goToPageInput.value = '';
    goToPageInput.classList.remove('input-shake');
    goToPageInput.placeholder = `1–${readerDoc.proxy.numPages}`;
    openModal(goToPageModal, readerPageIndicator);
    goToPageInput.focus();
  });

  function confirmGoToPage(): void {
    if (!readerDoc) return;
    const page = Number.parseInt(goToPageInput.value.trim(), 10);
    if (!Number.isFinite(page) || page < 1 || page > readerDoc.proxy.numPages) {
      goToPageInput.classList.remove('input-shake');
      void goToPageInput.offsetWidth; // restart the animation
      goToPageInput.classList.add('input-shake');
      return;
    }
    closeModal(goToPageModal);
    readerScroll.scrollTo({ top: readerScrollTopForPage(page), behavior: 'smooth' });
  }

  goToPageConfirmBtn.addEventListener('click', confirmGoToPage);
  goToPageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmGoToPage();
  });
  goToPageCancelBtn.addEventListener('click', () => closeModal(goToPageModal));

  async function renderReaderPageInto(container: HTMLDivElement, pageNumber: number): Promise<void> {
    if (!readerDoc) return;
    try {
      // Layout width (base * zoom, as last applied by relayoutReader) is the
      // single source of truth for render width — night-mode re-renders and
      // zoomed renders must agree with the placeholder sizes.
      const { wrapper, canvas } = await renderReaderPage(readerDoc.proxy, pageNumber, readerLayoutWidthPx, readerNightMode);
      if (!readerDoc || !document.contains(container)) return;
      container.innerHTML = '';
      // Container size is always driven by the placeholder's explicit
      // per-page height (set in renderReaderList), never by the canvas —
      // the canvas just fits inside it (.reader-page canvas has
      // max-width/max-height: 100%). This keeps layout/scroll math
      // (readerPageOffsets) exact and decoupled from per-page render
      // precision, so re-rendering a page for sharpness can never itself
      // shift the scroll position.
      container.appendChild(wrapper);
      readerRendered.set(pageNumber, canvas);
      // A re-render rebuilds the text layer, dropping any search highlights —
      // restore them (relayout after zoom/resize, eviction round-trips, etc.).
      if (searchActiveQuery && searchMatches.length > 0) {
        const active = searchCurrentIndex >= 0 ? searchMatches[searchCurrentIndex] : undefined;
        applySearchHighlightsOnPage(
          pageNumber,
          active && active.pageNumber === pageNumber ? active.spanIndex : null,
        );
      }
    } catch {
      // Placeholder stays empty; re-entering the viewport will retry since
      // readerRendered has no entry for this page.
    }
  }

  function evictReaderPage(container: HTMLDivElement, pageNumber: number): void {
    const canvas = readerRendered.get(pageNumber);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    container.innerHTML = '';
    readerRendered.delete(pageNumber);
  }

  /**
   * Sizes a placeholder/canvas wrapper for the current zoom level using the
   * page-1-derived aspect ratio estimate. Pages that have actually been
   * rendered get their own precise size from the canvas instead (see
   * `renderReaderPageInto`) — this is only the fallback for everything else,
   * but it must stay in sync with `readerScale` for ALL pages (not just
   * visible ones), otherwise the document's scroll height becomes
   * inconsistent mid-zoom and scrolling appears to "jump" between pages.
   */
  async function renderReaderList(): Promise<void> {
    if (!readerDoc) return;
    const numPages = readerDoc.proxy.numPages;
    // The .app column caps at 480px — the scroll viewport, not the window,
    // is the correct width reference (window.innerWidth overflowed on wide screens).
    readerBaseWidthPx = readerScroll.clientWidth || Math.min(window.innerWidth, 1000);
    resetReaderZoomState();

    // Scan every page's intrinsic aspect ratio (metadata only, no rendering)
    // so mixed-orientation documents get exact per-page slot heights. Batched
    // so a 1000+ page document doesn't serialize into a long stall.
    const doc = readerDoc;
    readerPageAspects = new Array<number>(numPages);
    const SIZE_SCAN_BATCH = 8;
    for (let start = 1; start <= numPages; start += SIZE_SCAN_BATCH) {
      const end = Math.min(numPages, start + SIZE_SCAN_BATCH - 1);
      const batch: Promise<void>[] = [];
      for (let p = start; p <= end; p += 1) {
        batch.push(
          doc.proxy.getPage(p).then((page) => {
            const vp = page.getViewport({ scale: 1 });
            readerPageAspects[p - 1] = vp.height / vp.width;
          }),
        );
      }
      await Promise.all(batch);
      if (readerDoc !== doc) return; // document was closed/replaced mid-scan
    }

    readerPageList.innerHTML = '';
    readerRendered.clear();

    readerObserver = new IntersectionObserver(
      (entries) => {
        // The pinch preview transform shifts every placeholder rect, which
        // would otherwise trigger render/evict churn at the stale width for
        // the whole gesture; endPinch's relayout re-observes everything.
        if (isPinching) return;
        for (const entry of entries) {
          const el = entry.target as HTMLDivElement;
          const pageNumber = Number(el.dataset.pageNumber);
          if (entry.isIntersecting) {
            if (!readerRendered.has(pageNumber)) {
              void renderReaderPageInto(el, pageNumber);
            }
          } else if (readerRendered.has(pageNumber)) {
            evictReaderPage(el, pageNumber);
          }
        }
        scheduleReaderPageIndicatorUpdate();
      },
      { root: readerScroll, rootMargin: '1500px 0px' },
    );

    for (let i = 1; i <= numPages; i += 1) {
      const placeholder = document.createElement('div');
      placeholder.className = 'reader-page';
      placeholder.dataset.pageNumber = String(i);
      readerPageList.appendChild(placeholder);
    }

    // Sizes every placeholder, sets --reader-page-width and observes the
    // placeholders (observe fires the initial render callbacks).
    relayoutReader();

    // Filling the list can materialize a classic (non-overlay) vertical
    // scrollbar, shrinking clientWidth after the fact — re-measure once so
    // zoom-1 content never overflows horizontally.
    if (readerScroll.clientWidth > 0 && Math.abs(readerScroll.clientWidth - readerBaseWidthPx) > 0.5) {
      readerBaseWidthPx = readerScroll.clientWidth;
      relayoutReader();
    }

    // Measure where page 1 actually starts relative to scrollTop=0 — the
    // scroll container's fixed chrome padding plus the list's top padding.
    readerScroll.scrollTop = 0;
    readerScroll.scrollLeft = 0;
    readerListTopOffsetPx =
      readerPageList.getBoundingClientRect().top -
      readerScroll.getBoundingClientRect().top +
      READER_LIST_TOP_PADDING_PX;

    readerScrubber.classList.toggle('hidden', numPages <= 3);
    readerScrubberThumb.style.top = '0px';
    readerPageIndicator.textContent = `1 / ${numPages}`;
  }

  let isOpeningReader = false;
  const showReaderOpening = (): void => readerOpeningOverlay.classList.remove('hidden');
  const hideReaderOpening = (): void => readerOpeningOverlay.classList.add('hidden');

  async function openReaderWithBytes(
    bytes: Uint8Array,
    name: string,
    sourceUri: string | null = null,
    returnTo: ScreenId = 'hub',
    initialPage: number = 1,
  ): Promise<void> {
    if (isOpeningReader) return;
    isOpeningReader = true;
    showReaderOpening();
    try {
      await validatePdf(bytes);
      await closeReaderDocument();
      readerDoc = await openReaderDocument(bytes);
      readerOutline = (await readerDoc.proxy.getOutline().catch(() => null)) as
        | OutlineItem[]
        | null;
      readerBytes = bytes;
      readerName = name;
      readerUri = sourceUri;
      readerReturnTo = returnTo;
      const savedNightMode = await Preferences.get({ key: 'readerNightMode' });
      readerNightMode = savedNightMode.value === 'true';
      readerNightModeBtn.classList.toggle('is-active', readerNightMode);
      screens.reader.classList.toggle('night-mode', readerNightMode);
      showScreen('reader');
      topBarTitle.textContent = readerName;
      await renderReaderList();
      if (initialPage > 1) {
        readerScroll.scrollTop = readerScrollTopForPage(initialPage);
      }
      await recordOpened({ uri: sourceUri, name });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      goToError(t('error.pdfOpenFailed'), message, returnTo);
    } finally {
      isOpeningReader = false;
      hideReaderOpening();
    }
  }

  // First-page thumbnail cache shared by the hub recents grid and the files
  // list. Keyed by `uri|size|lastModified` where metadata is known (files) or
  // plain uri (recents); Map insertion order doubles as the eviction order.
  const pdfThumbnailCache = new Map<string, string>();
  const PDF_THUMBNAIL_CACHE_MAX = 50;

  /**
   * Renders page 1 of the PDF behind `uri` to a data URL, caching the result
   * under `cacheKey`. Returns null on any failure (missing/unreadable/encrypted
   * file) — callers keep their placeholder; never throws into a render path.
   */
  async function getPdfThumbnail(uri: string, cacheKey: string): Promise<string | null> {
    const cached = pdfThumbnailCache.get(cacheKey);
    if (cached) return cached;
    try {
      const picked = await readPdfFromUri(uri);
      const doc = await loadPdfForThumbnails(picked.bytes);
      try {
        const dataUrl = await renderPageThumbnail(doc, 1, 220);
        pdfThumbnailCache.set(cacheKey, dataUrl);
        if (pdfThumbnailCache.size > PDF_THUMBNAIL_CACHE_MAX) {
          const oldest = pdfThumbnailCache.keys().next().value;
          if (oldest !== undefined) pdfThumbnailCache.delete(oldest);
        }
        return dataUrl;
      } finally {
        await destroyThumbnailDoc(doc);
      }
    } catch {
      return null;
    }
  }

  /**
   * Loads the first page of a recent entry as a real thumbnail and swaps it
   * into `container`. Keeps the placeholder icon on any failure (missing uri,
   * unreadable file) — never throws into the render path.
   */
  async function loadHubRecentThumbnail(entry: RecentEntry, container: HTMLElement): Promise<void> {
    if (!entry.uri) return;
    const dataUrl = await getPdfThumbnail(entry.uri, entry.uri);
    if (!dataUrl) return;
    const img = document.createElement('img');
    img.className = 'hub-recent-thumb-img';
    img.alt = '';
    img.src = dataUrl;
    container.replaceChildren(img);
  }

  async function renderHubRecentsGrid(): Promise<void> {
    const recents = (await getRecents()).slice(0, 3);
    recentsList.innerHTML = '';

    for (const entry of recents) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hub-recent-card';

      const thumb = document.createElement('span');
      thumb.className = 'hub-recent-thumb';
      const placeholder = document.createElement('span');
      placeholder.className = 'hub-recent-thumb-placeholder';
      placeholder.textContent = '📄';
      placeholder.ariaHidden = 'true';
      thumb.appendChild(placeholder);
      card.appendChild(thumb);

      const nameEl = document.createElement('span');
      nameEl.className = 'hub-recent-name';
      nameEl.textContent = entry.name;
      card.appendChild(nameEl);

      card.addEventListener('click', () => void openRecent(entry));
      recentsList.appendChild(card);

      void loadHubRecentThumbnail(entry, thumb);
    }

    const createCard = document.createElement('button');
    createCard.type = 'button';
    createCard.className = 'hub-recent-card hub-recent-card--create';

    const createIcon = document.createElement('span');
    createIcon.className = 'hub-recent-thumb hub-recent-thumb--create';
    createIcon.ariaHidden = 'true';
    createIcon.textContent = '+';
    createCard.appendChild(createIcon);

    const createLabel = document.createElement('span');
    createLabel.className = 'hub-recent-name';
    createLabel.dataset.i18n = 'hub.recents.createNew';
    createLabel.textContent = t('hub.recents.createNew');
    createCard.appendChild(createLabel);

    createCard.addEventListener('click', () => {
      const entryScreen = TOOL_ENTRY_SCREEN['image-to-pdf'];
      if (entryScreen) showScreen(entryScreen);
    });
    recentsList.appendChild(createCard);
  }

  async function openRecent(entry: RecentEntry): Promise<void> {
    if (!entry.uri) {
      showToast(t('toast.fileNoLongerAccessible'));
      await removeRecent(entry.name);
      await renderHubRecentsGrid();
      return;
    }
    if (isOpeningReader) return;
    showReaderOpening();
    const returnTo: ScreenId = getCurrentScreenId() === 'recents' ? 'recents' : 'hub';
    try {
      const picked = await readPdfFromUri(entry.uri);
      await openReaderWithBytes(picked.bytes, picked.name, entry.uri, returnTo, entry.lastPage);
    } catch {
      showToast(t('toast.fileNoLongerAccessible'));
      await removeRecent(entry.name);
      await renderHubRecentsGrid();
    } finally {
      hideReaderOpening();
    }
  }



  // ── Search Engine ──────────────────────────────────────────────────────────

  /** Removes all existing highlight marks from every rendered textLayer. */
  function clearSearchHighlights(): void {
    readerPageList.querySelectorAll('.textLayer .highlight').forEach((el) => {
      el.classList.remove('highlight', 'selected');
    });
  }

  /**
   * Applies highlight marks to the textLayer of a specific page.
   * `selectedSpanIndex` is the index within the page's own matches to mark as `.selected`.
   */
  function applySearchHighlightsOnPage(pageNumber: number, selectedSpanIndex: number | null): void {
    const container = readerPageList.querySelector(
      `.reader-page[data-page-number="${pageNumber}"] .textLayer`,
    ) as HTMLElement | null;
    if (!container) return;

    const spans = Array.from(container.querySelectorAll('span'));
    const q = searchActiveQuery.toLowerCase();

    spans.forEach((span, idx) => {
      const text = (span.textContent ?? '').toLowerCase();
      if (q && text.includes(q)) {
        span.classList.add('highlight');
        span.classList.toggle('selected', idx === selectedSpanIndex);
      } else {
        span.classList.remove('highlight', 'selected');
      }
    });
  }

  /** Refreshes the match-count badge and prev/next button states. */
  function updateSearchUI(): void {
    const total = searchMatches.length;
    if (!searchActiveQuery) {
      readerSearchCount.textContent = '';
      readerSearchCount.className = 'reader-search-count';
    } else if (total === 0) {
      readerSearchCount.textContent = t('search.noResults');
      readerSearchCount.className = 'reader-search-count no-results';
    } else {
      readerSearchCount.textContent = `${searchCurrentIndex + 1} / ${total}`;
      readerSearchCount.className = 'reader-search-count has-results';
    }
    readerSearchPrevBtn.disabled = total === 0;
    readerSearchNextBtn.disabled = total === 0;
  }

  /**
   * Scans every page's text content for `query` and populates `searchMatches`.
   * Runs asynchronously to avoid blocking the UI thread.
   */
  async function runSearch(query: string): Promise<void> {
    clearSearchHighlights();
    searchMatches = [];
    searchCurrentIndex = -1;
    searchActiveQuery = query;

    if (!readerDoc || !query) {
      updateSearchUI();
      return;
    }

    const q = query.toLowerCase();
    const numPages = readerDoc.proxy.numPages;

    for (let p = 1; p <= numPages; p++) {
      try {
        const page = await readerDoc.proxy.getPage(p);
        const textContent = await page.getTextContent();
        const items = textContent.items as Array<{ str: string }>;

        items.forEach((item, spanIdx) => {
          if (item.str.toLowerCase().includes(q)) {
            searchMatches.push({ pageNumber: p, spanIndex: spanIdx, text: item.str });
          }
        });
      } catch {
        // Skip unreadable pages silently
      }
    }

    if (searchMatches.length > 0) {
      searchCurrentIndex = 0;
      await navigateToMatch(0);
    }

    updateSearchUI();
  }

  /**
   * Scrolls to the page of match[index], waits for the page to render (if needed),
   * then highlights matching spans. Uses `.selected` for the active match.
   */
  async function navigateToMatch(index: number): Promise<void> {
    if (searchMatches.length === 0) return;

    const match = searchMatches[index];
    const { pageNumber } = match;

    // Scroll the page into view
    readerScroll.scrollTo({ top: readerScrollTopForPage(pageNumber), behavior: 'smooth' });

    // Wait until the IntersectionObserver has rendered this page (up to 800 ms)
    let waited = 0;
    while (!readerRendered.has(pageNumber) && waited < 800) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      waited += 50;
    }

    // Clear all highlights, then apply to current page
    clearSearchHighlights();

    // Highlight all matches on this page; mark the active one as selected
    const pageMatches = searchMatches.filter((m) => m.pageNumber === pageNumber);
    const activeMatchOnPage = pageMatches.findIndex(
      (m) => m.spanIndex === match.spanIndex,
    );
    applySearchHighlightsOnPage(pageNumber, activeMatchOnPage >= 0 ? match.spanIndex : null);

    updateSearchUI();
  }

  // ── Search Event Listeners ─────────────────────────────────────────────────

  readerSearchBtn.addEventListener('click', () => {
    const isOpen = !readerSearchPanel.classList.contains('hidden');
    if (isOpen) {
      // Close
      readerSearchPanel.classList.add('hidden');
      readerSearchBtn.classList.remove('search-active');
      readerSearchInput.value = '';
      clearSearchHighlights();
      searchMatches = [];
      searchCurrentIndex = -1;
      searchActiveQuery = '';
      updateSearchUI();
    } else {
      // Open
      readerSearchPanel.classList.remove('hidden');
      readerSearchBtn.classList.add('search-active');
      readerSearchInput.focus();
    }
  });

  readerSearchCloseBtn.addEventListener('click', () => {
    readerSearchPanel.classList.add('hidden');
    readerSearchBtn.classList.remove('search-active');
    readerSearchInput.value = '';
    clearSearchHighlights();
    searchMatches = [];
    searchCurrentIndex = -1;
    searchActiveQuery = '';
    updateSearchUI();
  });

  readerSearchInput.addEventListener('input', () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      void runSearch(readerSearchInput.value.trim());
    }, 350);
  });

  readerSearchPrevBtn.addEventListener('click', () => {
    if (searchMatches.length === 0) return;
    searchCurrentIndex = (searchCurrentIndex - 1 + searchMatches.length) % searchMatches.length;
    void navigateToMatch(searchCurrentIndex);
  });

  readerSearchNextBtn.addEventListener('click', () => {
    if (searchMatches.length === 0) return;
    searchCurrentIndex = (searchCurrentIndex + 1) % searchMatches.length;
    void navigateToMatch(searchCurrentIndex);
  });

  // ── Night Mode ─────────────────────────────────────────────────────────────

  readerNightModeBtn.addEventListener('click', () => {
    readerNightMode = !readerNightMode;
    readerNightModeBtn.classList.toggle('is-active', readerNightMode);
    screens.reader.classList.toggle('night-mode', readerNightMode);
    updateReaderNightChrome();
    void Preferences.set({ key: 'readerNightMode', value: String(readerNightMode) });

    // Clear the simple global CSS filter, as we now render Smart Dark Mode directly onto the canvas
    readerPageList.style.filter = 'none';

    // Re-render currently visible/rendered pages
    for (const pageNumber of Array.from(readerRendered.keys())) {
      const container = readerPageList.querySelector(`.reader-page[data-page-number="${pageNumber}"]`) as HTMLDivElement | null;
      if (container) {
        void renderReaderPageInto(container, pageNumber);
      }
    }

    // Re-render fullscreen reader pages if active
    if (isFullscreenReaderActive) {
      void updateFullscreenPages();
    }
  });

  document.addEventListener('copy', () => {
    if (getCurrentScreenId() !== 'reader') return;
    const selected = window.getSelection()?.toString();
    if (selected) void navigator.clipboard.writeText(selected);
  });

  async function openReaderToolBridge(tool: string): Promise<void> {
    if (!readerBytes) return;
    const bytes = readerBytes;
    const name = readerName;
    readerToolsSheet.classList.add('hidden');
    try {
      switch (tool) {
        case 'organize':
          await loadOrganizeFile(bytes, name);
          showScreen('organize');
          break;
        case 'rotate':
          await loadRotateFile(bytes, name);
          showScreen('rotate');
          break;
        case 'page-numbers':
          await loadPageNumbersFile(bytes, name);
          showScreen('page-numbers');
          break;
        case 'watermark':
          await loadWatermarkFile(bytes, name);
          showScreen('watermark');
          break;
        case 'merge':
          await addMergeFile(bytes, name);
          showScreen('merge-picker');
          break;
        case 'booklet':
          loadBookletFile(bytes, name);
          showScreen('config');
          break;
        default:
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      goToError(t('error.pdfOpenFailed'), message, 'reader');
    }
  }

  readerToolsBtn.addEventListener('click', () => {
    readerToolsSheet.classList.remove('hidden');
  });

  readerToolsBackdrop.addEventListener('click', () => {
    readerToolsSheet.classList.add('hidden');
  });

  // ── Reader navigation sheet (pages grid / outline / recents) ───────────────

  type ReaderNavTab = 'pages' | 'outline' | 'recents';
  type OutlineItem = { title: string; dest: unknown; url: string | null; items?: OutlineItem[] };
  let readerNavActiveTab: ReaderNavTab = 'pages';
  let readerOutline: OutlineItem[] | null = null;
  let navGridDoc: unknown = null; // proxy the grid was built for
  const navThumbCache = new Map<number, string>();
  const NAV_THUMB_CACHE_MAX = 200;
  const navOutlinePageCache = new Map<OutlineItem, number>();
  let navThumbObserver: IntersectionObserver | null = null;
  let navThumbActive = 0;
  const navThumbPending: { page: number; img: HTMLImageElement }[] = [];
  const NAV_THUMB_WIDTH_PX = 120;

  function resetReaderNavState(): void {
    readerNavSheet.classList.add('hidden');
    readerNavActiveTab = 'pages';
    readerOutline = null;
    navGridDoc = null;
    navThumbCache.clear();
    navOutlinePageCache.clear();
    navThumbPending.length = 0;
    navThumbObserver?.disconnect();
    navThumbObserver = null;
    readerNavGrid.innerHTML = '';
    readerNavOutlineList.innerHTML = '';
    readerNavRecentsList.innerHTML = '';
  }

  function closeReaderNavSheet(): void {
    readerNavSheet.classList.add('hidden');
  }

  /**
   * Small standalone thumbnail render for the grid — deliberately NOT
   * renderReaderPage: its per-page-number task map would cancel the main
   * reader's in-flight render of the same page. Always day-mode.
   */
  async function renderNavThumb(pageNumber: number): Promise<string | null> {
    const doc = readerDoc;
    if (!doc) return null;
    try {
      const page = await doc.proxy.getPage(pageNumber);
      const vp1 = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: NAV_THUMB_WIDTH_PX / vp1.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const url = canvas.toDataURL('image/jpeg', 0.8);
      canvas.width = 0;
      canvas.height = 0;
      return url;
    } catch {
      return null;
    }
  }

  function pumpNavThumbs(): void {
    // At most 2 concurrent thumb renders so the sheet never starves the
    // main reader's own page renders.
    while (navThumbActive < 2 && navThumbPending.length > 0) {
      const task = navThumbPending.shift()!;
      navThumbActive += 1;
      void (async () => {
        try {
          if (!readerDoc || !document.contains(task.img)) return;
          let url = navThumbCache.get(task.page) ?? null;
          if (!url) {
            url = await renderNavThumb(task.page);
            if (url) {
              navThumbCache.set(task.page, url);
              if (navThumbCache.size > NAV_THUMB_CACHE_MAX) {
                const oldest = navThumbCache.keys().next().value;
                if (oldest !== undefined) navThumbCache.delete(oldest);
              }
            }
          }
          if (url) {
            task.img.src = url;
            task.img.classList.add('is-loaded');
          } else {
            delete task.img.dataset.queued; // failed — allow a retry on re-enter
          }
        } finally {
          navThumbActive -= 1;
          pumpNavThumbs();
        }
      })();
    }
  }

  function buildNavGrid(): void {
    if (!readerDoc) return;
    if (navGridDoc === readerDoc.proxy) return; // already built for this document
    navGridDoc = readerDoc.proxy;
    readerNavGrid.innerHTML = '';
    navThumbPending.length = 0;
    navThumbObserver?.disconnect();
    navThumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target.querySelector('img');
          if (!img || img.dataset.queued) continue;
          img.dataset.queued = 'true';
          navThumbPending.push({ page: Number((entry.target as HTMLElement).dataset.page), img });
        }
        pumpNavThumbs();
      },
      { root: readerNavBody, rootMargin: '200px 0px' },
    );

    const numPages = readerDoc.proxy.numPages;
    for (let i = 1; i <= numPages; i += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'reader-nav-cell';
      cell.dataset.page = String(i);

      const thumb = document.createElement('span');
      thumb.className = 'reader-nav-cell-thumb';
      const img = document.createElement('img');
      img.alt = '';
      const aspect = readerPageAspects[i - 1] ?? Math.SQRT2;
      thumb.style.aspectRatio = `${1 / aspect}`;
      thumb.appendChild(img);
      cell.appendChild(thumb);

      const num = document.createElement('span');
      num.className = 'reader-nav-cell-num';
      num.textContent = String(i);
      cell.appendChild(num);

      cell.addEventListener('click', () => {
        closeReaderNavSheet();
        readerScroll.scrollTop = readerScrollTopForPage(i);
      });
      readerNavGrid.appendChild(cell);
      navThumbObserver.observe(cell);
    }
  }

  async function resolveOutlineToPage(item: OutlineItem): Promise<number | null> {
    if (!readerDoc) return null;
    const cached = navOutlinePageCache.get(item);
    if (cached !== undefined) return cached;
    try {
      let destArray: unknown = item.dest;
      if (typeof destArray === 'string') {
        destArray = await readerDoc.proxy.getDestination(destArray);
      }
      if (!Array.isArray(destArray) || !destArray[0]) return null;
      const idx = await readerDoc.proxy.getPageIndex(destArray[0]);
      const page = idx + 1;
      navOutlinePageCache.set(item, page);
      return page;
    } catch {
      return null;
    }
  }

  function buildNavOutline(): void {
    if (readerNavOutlineList.childElementCount > 0) return; // built once per document
    const walk = (items: OutlineItem[], level: number): void => {
      for (const item of items) {
        if (item.url) continue; // external links have no in-document target
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'reader-nav-outline-row';
        // Indent up to 3 levels deep; anything deeper aligns with level 3.
        row.style.paddingLeft = `${12 + Math.min(level, 2) * 16}px`;
        row.textContent = item.title || '—';
        row.addEventListener('click', async () => {
          const page = await resolveOutlineToPage(item);
          if (page === null) {
            showToast(t('reader.outlineLinkFailed'));
            return;
          }
          closeReaderNavSheet();
          readerScroll.scrollTop = readerScrollTopForPage(page);
        });
        readerNavOutlineList.appendChild(row);
        if (item.items && item.items.length > 0) walk(item.items, level + 1);
      }
    };
    walk(readerOutline ?? [], 0);
  }

  async function buildNavRecents(): Promise<void> {
    const recents = (await getRecents()).filter((r) => r.uri !== readerUri);
    readerNavRecentsList.innerHTML = '';
    if (recents.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'reader-nav-empty';
      empty.textContent = t('reader.noOtherRecents');
      readerNavRecentsList.appendChild(empty);
      return;
    }
    for (const entry of recents) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'reader-nav-recent-row';

      const thumb = document.createElement('span');
      thumb.className = 'reader-nav-recent-thumb';
      const cachedThumb = entry.uri ? pdfThumbnailCache.get(entry.uri) : undefined;
      if (cachedThumb) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = cachedThumb;
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = FILES_ICON_FILE_TEXT;
      }
      row.appendChild(thumb);

      const meta = document.createElement('span');
      meta.className = 'reader-nav-recent-meta';
      const nameEl = document.createElement('span');
      nameEl.className = 'reader-nav-recent-name';
      nameEl.textContent = entry.name;
      meta.appendChild(nameEl);
      const pageEl = document.createElement('span');
      pageEl.className = 'reader-nav-recent-page';
      pageEl.textContent = t('recents.pageAbbrev', { n: entry.lastPage });
      meta.appendChild(pageEl);
      row.appendChild(meta);

      row.addEventListener('click', () => {
        closeReaderNavSheet();
        void openRecent(entry);
      });
      readerNavRecentsList.appendChild(row);
    }
  }

  function setNavTab(tab: ReaderNavTab): void {
    readerNavActiveTab = tab;
    readerNavTabButtons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.navtab === tab);
    });
    readerNavPagesPane.classList.toggle('hidden', tab !== 'pages');
    readerNavOutlinePane.classList.toggle('hidden', tab !== 'outline');
    readerNavRecentsPane.classList.toggle('hidden', tab !== 'recents');
  }

  function openReaderNavSheet(): void {
    if (!readerDoc) return;
    const hasOutline = !!readerOutline && readerOutline.length > 0;
    readerNavOutlineTab.classList.toggle('hidden', !hasOutline);
    if (!hasOutline && readerNavActiveTab === 'outline') readerNavActiveTab = 'pages';
    buildNavGrid();
    if (hasOutline) buildNavOutline();
    void buildNavRecents();
    setNavTab(readerNavActiveTab);
    readerNavSheet.classList.remove('hidden');

    // Highlight the current page's cell and bring it into view.
    const current = readerPageAtScrollTop(readerScroll.scrollTop);
    readerNavGrid.querySelectorAll('.reader-nav-cell').forEach((cell) => {
      cell.classList.toggle('is-current', Number((cell as HTMLElement).dataset.page) === current);
    });
    if (readerNavActiveTab === 'pages') {
      readerNavGrid
        .querySelector(`.reader-nav-cell[data-page="${current}"]`)
        ?.scrollIntoView({ block: 'center' });
    }
  }

  readerNavBtn.addEventListener('click', openReaderNavSheet);
  readerNavBackdrop.addEventListener('click', closeReaderNavSheet);
  readerNavTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => setNavTab(btn.dataset.navtab as ReaderNavTab));
  });

  readerToolRows.forEach((row) => {
    row.addEventListener('click', () => {
      const tool = row.dataset.tool;
      if (tool) void openReaderToolBridge(tool);
    });
  });

  // --- FULLSCREEN READER SYSTEM (OPTION A: CSS ROTATION) ---
  let fsBarTimer: ReturnType<typeof setTimeout> | undefined;

  function toggleFullscreenBar(show?: boolean): void {
    if (show === undefined) {
      fsOverlayBar.classList.toggle('hidden');
    } else if (show) {
      fsOverlayBar.classList.remove('hidden');
    } else {
      fsOverlayBar.classList.add('hidden');
    }

    if (fsBarTimer) clearTimeout(fsBarTimer);
    if (!fsOverlayBar.classList.contains('hidden')) {
      fsBarTimer = setTimeout(() => {
        fsOverlayBar.classList.add('hidden');
      }, 3000);
    }
  }

  async function renderFullscreenPageInto(container: HTMLDivElement, pageNumber: number): Promise<void> {
    if (!readerDoc) return;
    container.innerHTML = '';
    
    // Determine target canvas width
    // In portrait modes (0, 180), use window.innerWidth, but cap it if it exceeds screen height.
    // In landscape modes (90, 270), the physical width of the page is the screen's height!
    const isSwapped = (fsRotationAngle % 180 !== 0);
    let fitWidth = isSwapped ? window.innerHeight : window.innerWidth;
    
    const isNativeLandscape = window.innerWidth > window.innerHeight;
    if (!isSwapped && !isNativeLandscape) {
      try {
        const page = await readerDoc.proxy.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const aspect = baseViewport.height / baseViewport.width;
        const screenHeight = window.innerHeight;
        if (fitWidth * aspect > screenHeight) {
          fitWidth = screenHeight / aspect;
        }
      } catch (err) {
      }
    }
    
    try {
      const { wrapper } = await renderReaderPage(readerDoc.proxy, pageNumber, fitWidth, readerNightMode);
      container.appendChild(wrapper);
    } catch {
      container.textContent = t('reader.pageLoadFailed');
    }
  }

  async function updateFullscreenPages(): Promise<void> {
    if (!readerDoc) return;
    fsViewer.innerHTML = '';
    
    const numPages = readerDoc.proxy.numPages;
    fsPageIndicator.textContent = `${fullscreenCurrentPage} / ${numPages}`;

    // Create 3 page slots: Previous (-100%), Current (0%), Next (+100%)
    // First slot: Previous page
    const prevEl = document.createElement('div');
    prevEl.className = 'fs-page';
    fsViewer.appendChild(prevEl);
    if (fullscreenCurrentPage > 1) {
      void renderFullscreenPageInto(prevEl, fullscreenCurrentPage - 1);
    }

    // Second slot: Current page
    const currEl = document.createElement('div');
    currEl.className = 'fs-page';
    fsViewer.appendChild(currEl);
    void renderFullscreenPageInto(currEl, fullscreenCurrentPage);

    // Third slot: Next page
    const nextEl = document.createElement('div');
    nextEl.className = 'fs-page';
    fsViewer.appendChild(nextEl);
    if (fullscreenCurrentPage < numPages) {
      void renderFullscreenPageInto(nextEl, fullscreenCurrentPage + 1);
    }

    // Centered slot is the 2nd one (index 1), translate fsViewer by -100% combined with rotation
    fsViewer.style.transition = 'none';
    const normalizedAngle = (fsRotationAngle % 360 + 360) % 360;
    fsViewer.style.transform = `translate(-50%, -50%) rotate(${normalizedAngle}deg) translate3d(-100%, 0, 0)`;
  }

  function setupFullscreenGestures(): void {
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let isDragging = false;
    let currentX = 0;
    let currentY = 0;
    let gestureType: 'none' | 'page-swipe' | 'page-scroll' = 'none';
    let startScrollTop = 0;

    const handlePointerDown = (e: PointerEvent) => {
      if (!isFullscreenReaderActive) return;
      startX = e.clientX;
      startY = e.clientY;
      startTime = performance.now();
      isDragging = true;
      gestureType = 'none';
      currentX = startX;
      currentY = startY;

      // The active page slot is the second slot (index 1) in the fsViewer container
      const activeContainer = fsViewer.children[1] as HTMLDivElement | undefined;
      if (activeContainer) {
        startScrollTop = activeContainer.scrollTop;
      } else {
        startScrollTop = 0;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      currentX = e.clientX;
      currentY = e.clientY;

      const dx = currentX - startX;
      const dy = currentY - startY;

      const normalizedAngle = (fsRotationAngle % 360 + 360) % 360;
      const isSwapped = (normalizedAngle % 180 !== 0);

      // Determine gesture type if not already decided
      if (gestureType === 'none') {
        const dist = Math.hypot(dx, dy);
        if (dist > 8) {
          if (isSwapped) {
            // Landscape (rotated): page-swipe is vertical (dy), page-scroll is horizontal (dx)
            if (Math.abs(dy) > Math.abs(dx)) {
              gestureType = 'page-swipe';
              fsViewer.style.transition = 'none';
            } else {
              gestureType = 'page-scroll';
            }
          } else {
            // Portrait: page-swipe is horizontal (dx), page-scroll is vertical (dy)
            if (Math.abs(dx) > Math.abs(dy)) {
              gestureType = 'page-swipe';
              fsViewer.style.transition = 'none';
            } else {
              gestureType = 'page-scroll';
            }
          }
        }
        return; // Don't track offset until gesture is determined
      }

      // Prevent native browser scroll/pan/refresh actions while swiping/scrolling pages
      if (e.cancelable) {
        e.preventDefault();
      }

      if (gestureType === 'page-swipe') {
        // Swipe offset depends on rotation!
        let dragOffset = 0;
        if (normalizedAngle === 90) {
          dragOffset = dy;
        } else if (normalizedAngle === 270) {
          dragOffset = -dy;
        } else if (normalizedAngle === 180) {
          dragOffset = -dx;
        } else {
          dragOffset = dx;
        }

        // Base translation is -100% of viewer width (which is screen width/height)
        const baseTranslateVal = isSwapped ? window.innerHeight : window.innerWidth;
        const pct = -100 + (dragOffset / baseTranslateVal) * 100;
        fsViewer.style.transform = `translate(-50%, -50%) rotate(${normalizedAngle}deg) translate3d(${pct}%, 0, 0)`;
      } else if (gestureType === 'page-scroll') {
        // Manual scrolling by adjusting scrollTop of the active container
        const activeContainer = fsViewer.children[1] as HTMLDivElement | undefined;
        if (activeContainer) {
          if (isSwapped) {
            // Landscape (rotated): scroll is along the physical X axis (dx)
            if (normalizedAngle === 90) {
              activeContainer.scrollTop = startScrollTop - dx;
            } else if (normalizedAngle === 270) {
              activeContainer.scrollTop = startScrollTop + dx;
            }
          } else {
            // Portrait: scroll is along the physical Y axis (dy)
            if (normalizedAngle === 0) {
              activeContainer.scrollTop = startScrollTop - dy;
            } else if (normalizedAngle === 180) {
              activeContainer.scrollTop = startScrollTop + dy;
            }
          }
        }
      }
    };

    const handlePointerUpOrCancel = () => {
      if (!isDragging) {
        gestureType = 'none';
        return;
      }
      isDragging = false;

      const dx = currentX - startX;
      const dy = currentY - startY;
      const dt = performance.now() - startTime;

      const currentGesture = gestureType;
      gestureType = 'none';

      if (currentGesture === 'page-swipe') {
        const swipeDistThreshold = 80;
        const swipeTimeThreshold = 300;
        const isFast = dt < swipeTimeThreshold;

        // Determine swipe distance along active layout axis
        let dist = 0;
        const normalizedAngle = (fsRotationAngle % 360 + 360) % 360;
        if (normalizedAngle === 90) {
          dist = dy;
        } else if (normalizedAngle === 270) {
          dist = -dy;
        } else if (normalizedAngle === 180) {
          dist = -dx;
        } else {
          dist = dx;
        }

        const numPages = readerDoc ? readerDoc.proxy.numPages : 1;
        fsViewer.style.transition = 'transform 0.2s ease-out';

        if (dist > swipeDistThreshold || (isFast && dist > 20)) {
          if (fullscreenCurrentPage > 1) {
            fsViewer.style.transform = `translate(-50%, -50%) rotate(${normalizedAngle}deg) translate3d(0%, 0, 0)`;
            setTimeout(() => {
              fullscreenCurrentPage -= 1;
              void updateFullscreenPages();
              void updateLastPage(readerName, fullscreenCurrentPage);
            }, 200);
          } else {
            fsViewer.style.transform = `translate(-50%, -50%) rotate(${normalizedAngle}deg) translate3d(-100%, 0, 0)`;
          }
        } else if (dist < -swipeDistThreshold || (isFast && dist < -20)) {
          if (fullscreenCurrentPage < numPages) {
            fsViewer.style.transform = `translate(-50%, -50%) rotate(${normalizedAngle}deg) translate3d(-200%, 0, 0)`;
            setTimeout(() => {
              fullscreenCurrentPage += 1;
              void updateFullscreenPages();
              void updateLastPage(readerName, fullscreenCurrentPage);
            }, 200);
          } else {
            fsViewer.style.transform = `translate(-50%, -50%) rotate(${normalizedAngle}deg) translate3d(-100%, 0, 0)`;
          }
        } else {
          fsViewer.style.transform = `translate(-50%, -50%) rotate(${normalizedAngle}deg) translate3d(-100%, 0, 0)`;
        }
      } else if (currentGesture === 'none') {
        const tapThreshold = 10;
        if (Math.hypot(dx, dy) < tapThreshold && dt < 250) {
          toggleFullscreenBar();
        }
      }
    };

    fsViewer.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUpOrCancel);
    window.addEventListener('pointercancel', handlePointerUpOrCancel);
  }

  function updateFullscreenOrientation(): void {
    const normalizedAngle = (fsRotationAngle % 360 + 360) % 360;

    // isCssSwapped: content is CSS-rotated 90/270 degrees
    const isCssSwapped = (normalizedAngle % 180 !== 0);
    const width = isCssSwapped ? window.innerHeight : window.innerWidth;
    const height = isCssSwapped ? window.innerWidth : window.innerHeight;

    fsViewer.style.width = `${width}px`;
    fsViewer.style.height = `${height}px`;

    // Also set fs-landscape-mode when device is natively in landscape (no CSS rotation needed)
    const isLandscape = isCssSwapped || window.innerWidth > window.innerHeight;
    readerFullscreenOverlay.classList.toggle('fs-landscape-mode', isLandscape);

    void updateFullscreenPages();
  }

  async function openFullscreenReader(): Promise<void> {
    if (!readerDoc) return;
    isFullscreenReaderActive = true;
    fsRotationAngle = 0;

    // Find current page in vertical scroll
    fullscreenCurrentPage = Math.min(readerDoc.proxy.numPages, readerPageAtScrollTop(readerScroll.scrollTop));

    readerFullscreenOverlay.classList.remove('hidden');
    updateFullscreenOrientation();

    toggleFullscreenBar(true);

    // Re-render on native orientation change (resize updates innerWidth/innerHeight)
    fsNativeOrientationHandler = () => { updateFullscreenOrientation(); };
    screen.orientation.addEventListener('change', fsNativeOrientationHandler);
  }

  function closeFullscreenReader(): void {
    isFullscreenReaderActive = false;
    if (fsNativeOrientationHandler) {
      screen.orientation.removeEventListener('change', fsNativeOrientationHandler);
      fsNativeOrientationHandler = null;
    }

    readerFullscreenOverlay.classList.add('hidden');

    // Sync back scroll position in normal reader
    if (readerDoc) {
      readerScroll.scrollTop = readerScrollTopForPage(fullscreenCurrentPage);
    }
  }

  // Bind fullscreen events
  readerFullscreenBtn.addEventListener('click', () => {
    void openFullscreenReader();
  });

  fsExitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeFullscreenReader();
  });

  fsRotateLeftBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fsRotationAngle = (fsRotationAngle - 90 + 360) % 360;
    updateFullscreenOrientation();
    toggleFullscreenBar(true);
  });

  fsRotateRightBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fsRotationAngle = (fsRotationAngle + 90) % 360;
    updateFullscreenOrientation();
    toggleFullscreenBar(true);
  });

  setupFullscreenGestures();

  // Auto-open fullscreen reader when device rotates to landscape while in reader screen
  screen.orientation.addEventListener('change', () => {
    if (getCurrentScreenId() !== 'reader') return;
    if (window.innerWidth > window.innerHeight) {
      if (!isFullscreenReaderActive) {
        isFullscreenAutoOpened = true;
        void openFullscreenReader();
      }
    } else {
      if (isFullscreenReaderActive && isFullscreenAutoOpened) {
        isFullscreenAutoOpened = false;
        closeFullscreenReader();
      }
    }
  });

  byId<HTMLButtonElement>('hubCreateBookletBtn').addEventListener('click', () => {
    const entry = TOOL_ENTRY_SCREEN.booklet; // same entry point as the Booklet tool-row
    if (entry) showScreen(entry);
  });

  // ── Hub hero brand-moment: first-ever open flies in (A); later opens fold in
  //    place (B); reduced-motion / same-session revisits show it resting. ──────
  {
    const BRAND_SEEN_KEY = 'bindery.brandIntroSeen';
    // QC hooks: ?heroIntro=A|B|off force a path; =reset clears the persisted flag.
    const forcedHero = new URLSearchParams(location.search).get('heroIntro');
    if (forcedHero === 'reset') { try { localStorage.removeItem(BRAND_SEEN_KEY); } catch { /* ignore */ } }

    const fly = byId<HTMLDivElement>('heroFly');
    const booklet = byId<HTMLDivElement>('heroBooklet');
    const deck = byId<HTMLDivElement>('heroDeck');
    const stageEl = byId<HTMLDivElement>('heroStage');
    const hubHero = byId<HTMLDivElement>('hubHero');
    const hubScreen = byId<HTMLElement>('screen-hub');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const LEAVES = 4;
    const INTRINSIC_W = 108;
    const INTRINSIC_H = 74;
    void fly; // layer referenced only for clarity; visibility follows #screen-hub

    const cover = document.createElement('div');
    cover.className = 'hero-cover';
    cover.innerHTML = '<div class="emb"></div>';
    deck.appendChild(cover);
    for (let i = 0; i < LEAVES; i++) {
      const leaf = document.createElement('div');
      leaf.className = 'hero-leaf';
      leaf.style.setProperty('--i', String(i));
      leaf.innerHTML =
        '<div class="hero-face l"><div class="hero-paper"></div></div>' +
        '<div class="hero-face r"><div class="hero-paper"></div><div class="hero-paper back"></div><div class="hero-hinge"></div></div>';
      deck.appendChild(leaf);
    }

    let homeScale = 1;
    function homeTransform(): string {
      const hub = hubScreen.getBoundingClientRect();
      const st = stageEl.getBoundingClientRect();
      homeScale = Math.max(0.6, (st.height * 0.62) / INTRINSIC_H);
      const w = INTRINSIC_W * homeScale, h = INTRINSIC_H * homeScale;
      const left = (st.left - hub.left) + (st.width - w) / 2;
      const top = (st.top - hub.top) + (st.height - h) / 2;
      return `translate(${left}px, ${top}px) scale(${homeScale})`;
    }
    function splashTransform(): string {
      const hub = hubScreen.getBoundingClientRect();
      const scale = homeScale * 1.8;
      const w = INTRINSIC_W * scale;
      const left = (window.innerWidth / 2 - hub.left) - w / 2;
      const top = (window.innerHeight * 0.3 - hub.top);
      return `translate(${left}px, ${top}px) scale(${scale})`;
    }

    let timers: ReturnType<typeof setTimeout>[] = [];
    let armedSkip: (() => void) | null = null;
    const clearTimers = (): void => { timers.forEach(clearTimeout); timers = []; };
    const at = (ms: number, fn: () => void): void => { timers.push(setTimeout(fn, ms)); };
    function disarmSkip(): void {
      if (armedSkip) { hubScreen.removeEventListener('pointerdown', armedSkip); armedSkip = null; }
    }
    function revealCopy(): void { hubHero.classList.add('hero-revealed'); hubHero.classList.remove('hero-armed'); }

    function settle(): void {
      clearTimers(); disarmSkip();
      booklet.classList.add('frozen', 'landed');
      booklet.style.transition = 'none';
      booklet.setAttribute('data-phase', 'rest');
      booklet.style.transform = homeTransform();
      revealCopy();
    }
    function armSkip(): void {
      disarmSkip();
      armedSkip = () => settle();
      hubScreen.addEventListener('pointerdown', armedSkip, { once: true });
    }

    function playA(): void { // splash → fold → fly into the hero stage
      clearTimers();
      booklet.classList.remove('frozen', 'landed');
      hubHero.classList.add('hero-armed'); hubHero.classList.remove('hero-revealed');
      booklet.style.transition = 'none';
      booklet.setAttribute('data-phase', 'settle');
      booklet.style.transform = splashTransform();
      void booklet.offsetWidth;
      armSkip();
      at(340, () => booklet.setAttribute('data-phase', 'fold'));
      at(340 + 1150, () => {
        booklet.style.transition = 'transform .92s cubic-bezier(.34,1.3,.5,1)';
        booklet.classList.add('landed');
        booklet.setAttribute('data-phase', 'rest');
        booklet.style.transform = homeTransform();
        at(200, revealCopy);
        at(1000, () => { booklet.classList.add('frozen'); disarmSkip(); });
      });
      at(2600, settle); // hard fallback: never stay busy past ~2.6s
    }

    function playB(): void { // fold in place at the hero stage
      clearTimers();
      booklet.classList.remove('frozen', 'landed');
      booklet.classList.add('landed'); // stays glued to the stage the whole time
      hubHero.classList.add('hero-armed'); hubHero.classList.remove('hero-revealed');
      booklet.style.transition = 'none';
      booklet.style.transform = homeTransform();
      booklet.setAttribute('data-phase', 'load');
      void booklet.offsetWidth;
      armSkip();
      at(320, () => booklet.setAttribute('data-phase', 'settle'));
      at(320 + 900, () => { booklet.setAttribute('data-phase', 'fold'); revealCopy(); });
      at(320 + 900 + 1050, () => { booklet.setAttribute('data-phase', 'rest'); booklet.classList.add('frozen'); disarmSkip(); });
      at(3200, disarmSkip);
    }

    let played = false;
    function maybePlayHeroIntro(): void {
      if (getCurrentScreenId() !== 'hub') return;
      if (played && !forcedHero) { settle(); return; }
      played = true;
      requestAnimationFrame(() => {
        booklet.style.transform = homeTransform();
        if (reduceMotion.matches || forcedHero === 'off') { settle(); return; }
        let seen = false;
        try { seen = localStorage.getItem(BRAND_SEEN_KEY) === 'true'; } catch { seen = false; }
        if (forcedHero === 'B') { playB(); return; }
        if (forcedHero === 'A' || !seen) {
          try { localStorage.setItem(BRAND_SEEN_KEY, 'true'); } catch { /* ignore */ }
          playA();
        } else {
          playB();
        }
      });
    }
    requestHeroIntro = maybePlayHeroIntro;

    // keep the resting booklet glued to the stage on resize / theme change
    window.addEventListener('resize', () => {
      if (booklet.classList.contains('landed')) { booklet.style.transition = 'none'; booklet.style.transform = homeTransform(); }
    });
  }

  hubOpenReaderBtn.addEventListener('click', async () => {
    try {
      const picked = await pickPdfWithPersistentUri();
      if (!picked) return;
      const file = await readPdfFromUri(picked.uri);
      await openReaderWithBytes(file.bytes, file.name, picked.persistent ? picked.uri : null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      goToError(t('error.pdfOpenFailed'), message, 'hub');
    }
  });

  retryBtn.addEventListener('click', () => showScreen(returnScreenOnError));

  function hasUnsavedResultPdf(): boolean {
    switch (getCurrentScreenId()) {
      case 'merge-result': return mergedPdf !== null && mergeSaveState !== 'saved';
      case 'organize-result': return organizeResultPdf !== null && organizeSaveState !== 'saved';
      case 'rotate-result': return rotateResultPdf !== null && rotateSaveState !== 'saved';
      case 'page-numbers-result': return pageNumbersResultPdf !== null && pageNumbersSaveState !== 'saved';
      case 'watermark-result': return watermarkResultPdf !== null && watermarkSaveState !== 'saved';
      case 'result': return booklet !== null && bookletSaveState !== 'saved';
      default: return false;
    }
  }

  backBtn.addEventListener('click', async () => {
    const current = getCurrentScreenId();
    if (current === 'error') {
      showScreen(returnScreenOnError);
      return;
    }
    if (current === 'crop') {
      cropCancelBtn.click();
      return;
    }
    if (current === 'reader') {
      if (!saveDocModal.classList.contains('hidden')) {
        closeModal(saveDocModal);
        return;
      }
      if (isFullscreenReaderActive) {
        closeFullscreenReader();
        return;
      }
      if (!readerNavSheet.classList.contains('hidden')) {
        closeReaderNavSheet();
        return;
      }
      if (!readerToolsSheet.classList.contains('hidden')) {
        readerToolsSheet.classList.add('hidden');
        return;
      }
      showScreen(readerReturnTo);
      return;
    }
    if (hasUnsavedResultPdf()) {
      const discard = await showConfirmDialog(t('confirm.discardResult'));
      if (!discard) return;
    }
    if (current === 'image-to-pdf') {
      clearImageToPdfState();
    }
    showScreen(PARENT_SCREEN[current] ?? 'hub');
  });

  savePdfBtn.addEventListener('click', () => {
    if (!readerBytes) return;
    saveDocNameInput.value = readerName;
    
    // Select the "private" save option by default
    const privateRadio = saveDocModal.querySelector('input[value="private"]') as HTMLInputElement;
    if (privateRadio) privateRadio.checked = true;

    openModal(saveDocModal, savePdfBtn);
  });

  saveDocCancelBtn.addEventListener('click', () => {
    closeModal(saveDocModal);
  });

  saveDocConfirmBtn.addEventListener('click', async () => {
    if (!readerBytes) return;
    let newName = saveDocNameInput.value.trim();
    if (!newName) {
      showToast(t('toast.invalidFileName'));
      return;
    }
    if (!newName.toLowerCase().endsWith('.pdf')) {
      newName += '.pdf';
    }

    const option = (saveDocModal.querySelector('input[name="saveOption"]:checked') as HTMLInputElement)?.value || 'private';
    saveDocConfirmBtn.disabled = true;
    saveDocConfirmBtnLabel.classList.add('hidden');
    saveDocConfirmSpinner.classList.remove('hidden');

    try {
      if (option === 'private') {
        const privateDirs = ['/scans/', '/booklets/', '/merges/', '/edits/', '/downloads/'];
        const isCurrentlyPrivate = readerUri && privateDirs.some((d) => readerUri!.includes(d));
        let newUri = '';
        if (isCurrentlyPrivate && readerUri) {
          // Determine which subfolder the file is in
          const match = readerUri.match(/\/(scans|booklets|merges|edits|downloads)\//);
          const subDir = match ? match[1] : 'scans';
          newUri = await movePrivateItem(`${subDir}/${readerName}`, `${subDir}/${newName}`);
          await removeRecent(readerName);
        } else {
          newUri = await savePdfPrivately(readerBytes, `scans/${newName}`);
        }
        
        readerName = newName;
        readerUri = newUri;
        topBarTitle.textContent = readerName;
        
        await recordOpened({ uri: newUri, name: newName });
        showToast(t('toast.savedToBindery'));
      } else {
        const publicUri = await savePdfToDevice(readerBytes, newName);
        
        readerName = newName;
        readerUri = publicUri;
        topBarTitle.textContent = readerName;
        
        await recordOpened({ uri: publicUri, name: newName });
        showToast(t('toast.savedToDevice'));
      }
      
      closeModal(saveDocModal);
      void renderHubRecentsGrid();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t('toast.saveError', { message }));
    } finally {
      saveDocConfirmBtn.disabled = false;
      saveDocConfirmBtnLabel.classList.remove('hidden');
      saveDocConfirmSpinner.classList.add('hidden');
    }
  });

  sharePdfBtn.addEventListener('click', async () => {
    if (!readerBytes) return;
    try {
      await sharePdf(readerBytes, readerName, t('reader.shareDocument'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t('toast.shareErrorDetailed', { message }));
    }
  });

  // Listen for native Android back button / gestures
  App.addListener('backButton', () => {
    if (modalStack.length > 0) {
      closeModal(modalStack[modalStack.length - 1].el);
      return;
    }
    if (!onboardingOverlay.classList.contains('hidden')) {
      if (onboardingIndex > 0) {
        onboardingIndex -= 1;
        renderOnboarding();
      } else {
        void App.exitApp();
      }
      return;
    }
    const current = getCurrentScreenId();
    if (current === 'files' && currentFolderPath !== '') {
      currentFolderPath = currentFolderPath.includes('/')
        ? currentFolderPath.slice(0, currentFolderPath.lastIndexOf('/'))
        : '';
      void renderFilesList();
      return;
    }
    if (current === 'hub' || current === 'files' || current === 'settings') {
      void App.exitApp();
    } else {
      backBtn.click();
    }
  });

  function formatRelativeDate(timestamp: number): string {
    const now = new Date();
    const date = new Date(timestamp);
    
    // Reset hours to check day difference
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    
    const diffDays = Math.round((nowDay - dateDay) / (1000 * 60 * 60 * 24));
    const locale = getLanguage() === 'tr' ? 'tr-TR' : 'en-US';
    const timeStr = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

    if (diffDays === 0) {
      return `${t('date.today')}, ${timeStr}`;
    } else if (diffDays === 1) {
      return `${t('date.yesterday')}, ${timeStr}`;
    } else if (diffDays < 7) {
      return `${t(`date.day.${date.getDay()}`)}, ${timeStr}`;
    } else {
      return date.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
      });
    }
  }

  async function renderRecentsListLarge(): Promise<void> {
    const recents = await getRecents();
    recentsEmptyHint.classList.toggle('hidden', recents.length > 0);
    recentsListLarge.innerHTML = '';
    
    for (const entry of recents) {
      const card = document.createElement('div');
      card.className = 'recent-item-compact';

      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'recent-icon-wrapper';
      iconWrapper.textContent = '📄';
      iconWrapper.ariaHidden = 'true';
      card.appendChild(iconWrapper);

      const details = document.createElement('div');
      details.className = 'recent-item-details';

      const name = document.createElement('span');
      name.className = 'recent-item-name';
      name.textContent = entry.name;
      details.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'recent-item-meta';

      const timeSpan = document.createElement('span');
      timeSpan.textContent = formatRelativeDate(entry.openedAt);
      meta.appendChild(timeSpan);

      const pageBadge = document.createElement('span');
      pageBadge.className = 'recent-page-badge';
      pageBadge.textContent = t('recents.pageAbbrev', { n: entry.lastPage });
      meta.appendChild(pageBadge);

      details.appendChild(meta);
      card.appendChild(details);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'recent-remove-btn';
      removeBtn.textContent = '✕';
      removeBtn.ariaLabel = t('recents.removeFromHistory');
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeRecent(entry.name);
        void renderRecentsListLarge();
      });
      card.appendChild(removeBtn);

      card.addEventListener('click', () => {
        void openRecent(entry);
      });

      recentsListLarge.appendChild(card);
    }
  }

  /** Renders the tappable breadcrumb trail (🏠 › folder › subfolder) for the current path. */
  function renderFilesBreadcrumb(): void {
    filesBreadcrumb.innerHTML = '';
    const parts = currentFolderPath ? currentFolderPath.split('/') : [];

    const homeBtn = document.createElement('button');
    homeBtn.className = 'breadcrumb-segment';
    homeBtn.textContent = '🏠';
    homeBtn.ariaLabel = t('files.goToRoot');
    if (parts.length === 0) {
      homeBtn.classList.add('is-current');
      homeBtn.disabled = true;
    } else {
      homeBtn.addEventListener('click', () => {
        currentFolderPath = '';
        void renderFilesList();
      });
    }
    filesBreadcrumb.appendChild(homeBtn);

    let accPath = '';
    parts.forEach((part, idx) => {
      accPath = accPath ? `${accPath}/${part}` : part;
      const targetPath = accPath;

      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      sep.ariaHidden = 'true';
      filesBreadcrumb.appendChild(sep);

      const segBtn = document.createElement('button');
      segBtn.className = 'breadcrumb-segment';
      segBtn.textContent = part;
      if (idx === parts.length - 1) {
        segBtn.classList.add('is-current');
        segBtn.disabled = true;
      } else {
        segBtn.addEventListener('click', () => {
          currentFolderPath = targetPath;
          void renderFilesList();
        });
      }
      filesBreadcrumb.appendChild(segBtn);
    });
  }

  const FILE_TOOL_LOADERS: Record<string, (bytes: Uint8Array, name: string, uri: string) => Promise<void>> = {
    reader: async (bytes, name, uri) => {
      await openReaderWithBytes(bytes, name, uri);
    },
    booklet: async (bytes, name) => {
      showScreen('picker');
      loadBookletFile(bytes, name);
    },
    organize: async (bytes, name) => {
      resetOrganizeScreen();
      showScreen('organize');
      await loadOrganizeFile(bytes, name);
    },
    rotate: async (bytes, name) => {
      resetRotateScreen();
      showScreen('rotate');
      await loadRotateFile(bytes, name);
    },
    'page-numbers': async (bytes, name) => {
      resetPageNumbersScreen();
      showScreen('page-numbers');
      await loadPageNumbersFile(bytes, name);
    },
    watermark: async (bytes, name) => {
      resetWatermarkScreen();
      showScreen('watermark');
      await loadWatermarkFile(bytes, name);
    },
    merge: async (bytes, name) => {
      mergeFiles = [];
      showScreen('merge-picker');
      await addMergeFile(bytes, name);
    },
  };

  async function openFileInTool(toolId: string, uri: string): Promise<void> {
    const loader = FILE_TOOL_LOADERS[toolId];
    if (!loader) return;
    try {
      const { bytes, name } = await readPdfFromUri(uri);
      await loader(bytes, name, uri);
    } catch {
      showToast(t('toast.fileOpenError'));
    }
  }

  /** Opens the "⋮" overflow menu listing the available actions for one file or folder row. */
  function openFileActionsModal(item: FileEntryInfo, isDir: boolean): void {
    fileActionsTitle.textContent = item.name;
    fileActionsList.innerHTML = '';

    const addAction = (icon: string, label: string, onClick: () => void | Promise<void>) => {
      const btn = document.createElement('button');
      btn.className = 'folder-select-item';
      btn.textContent = `${icon} ${label}`;
      btn.addEventListener('click', () => {
        closeModal(fileActionsModal);
        void onClick();
      });
      fileActionsList.appendChild(btn);
    };

    if (!isDir) {
      addAction('↗️', 'Open in...', () => {
        openInToolUri = item.uri;
        openModal(openInToolSheet);
      });

      addAction('📤', t('common.share'), async () => {
        try {
          const picked = await readPdfFromUri(item.uri);
          await sharePdf(picked.bytes, item.name, t('common.share'));
        } catch {
          showToast(t('toast.shareError'));
        }
      });

      addAction('📋', t('action.move'), async () => {
        moveSourceFile = item;
        moveTargetFolder = null;
        moveDocConfirmBtn.disabled = true;
        await renderMoveFolderList();
        openModal(moveDocModal);
      });
    }

    addAction('✏️', t('action.rename'), async () => {
      const currentName = item.name;
      const input = prompt(
        isDir ? t('common.newFolderPrompt') : t('common.newFileNamePrompt'),
        currentName,
      );
      if (!input || !input.trim()) return;
      let newName = input.trim().replace(/[/\\:*?"<>|]/g, '_');
      if (!isDir && !newName.toLowerCase().endsWith('.pdf')) {
        newName += '.pdf';
      }
      if (newName === currentName) return;
      try {
        const oldPath = currentFolderPath ? `${currentFolderPath}/${currentName}` : currentName;
        const newPath = currentFolderPath ? `${currentFolderPath}/${newName}` : newName;
        const newUri = await movePrivateItem(oldPath, newPath);
        if (!isDir) {
          try {
            await removeRecent(currentName);
            await recordOpened({ uri: newUri, name: newName });
          } catch {
            // not in recents, ignore
          }
        }
        showToast(t('toast.renamed', { name: newName }));
        void renderFilesList();
      } catch {
        showToast(t('toast.renameError'));
      }
    });

    addAction('🗑️', t('action.delete'), async () => {
      const label = isDir
        ? t('files.deleteConfirmFolder', { name: item.name })
        : t('files.deleteConfirmFile', { name: item.name });
      const ok = await showConfirmDialog(t('files.deleteConfirmQuestion', { label }));
      if (!ok) return;
      try {
        const itemPath = currentFolderPath ? `${currentFolderPath}/${item.name}` : item.name;
        await deletePrivateItem(itemPath, isDir);
        if (!isDir) await removeRecent(item.name);
        showToast(isDir ? t('toast.folderDeleted') : t('toast.fileDeleted'));
        void renderFilesList();
      } catch {
        showToast(t('toast.deleteError'));
      }
    });

    openModal(fileActionsModal);
  }

  const FILES_ICON_FOLDER =
    '<svg class="tool-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
  const FILES_ICON_FILE_TEXT =
    '<svg class="tool-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
  const FILES_ICON_ELLIPSIS =
    '<svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>';

  // Bumped on every renderFilesList() call so in-flight async thumbnail loops
  // from a previous render (other folder / other sort order) stop writing to
  // the rebuilt DOM.
  let filesRenderGeneration = 0;
  let filesLastRenderedPath: string | null = null;

  /** Shows/hides already-rendered file cards by name; never re-reads the folder. */
  function applyFilesSearchFilter(): void {
    const query = filesSearchInput.value.trim().toLocaleLowerCase();
    filesList.querySelectorAll<HTMLElement>('.file-item-card').forEach((card) => {
      const name = (card.dataset.name ?? '').toLocaleLowerCase();
      card.classList.toggle('hidden', query !== '' && !name.includes(query));
    });
  }

  async function renderFilesList(): Promise<void> {
    renderFilesBreadcrumb();
    const generation = ++filesRenderGeneration;
    if (filesLastRenderedPath !== currentFolderPath) {
      filesSearchInput.value = '';
      filesLastRenderedPath = currentFolderPath;
    }

    let raw: Awaited<ReturnType<typeof listPrivateFolder>>;
    try {
      raw = await listPrivateFolder(currentFolderPath);
    } catch {
      showToast(t('files.loadError'));
      return;
    }
    if (generation !== filesRenderGeneration) return;
    const items = sortFileEntries(raw, filesSortMode);
    const isEmpty = items.length === 0;
    filesEmptyHint.classList.toggle('hidden', !isEmpty);
    filesList.innerHTML = '';

    // The list renders instantly with placeholder icons; real PDF thumbnails
    // are filled in afterwards, one at a time (see loop below the card loop).
    const thumbTasks: { uri: string; cacheKey: string; thumb: HTMLElement }[] = [];

    for (const item of items) {
      const isDir = item.type === 'directory';

      const card = document.createElement('div');
      card.className = 'file-item-card';
      if (isDir) card.classList.add('is-folder');
      card.dataset.name = item.name;

      // Thumbnail box: folder icon on tonal background, or file placeholder
      // that the async loop below swaps for a real first-page render.
      const thumb = document.createElement('span');
      thumb.className = 'file-item-thumb';
      thumb.ariaHidden = 'true';
      if (isDir) {
        thumb.classList.add('file-item-thumb--folder');
        thumb.innerHTML = FILES_ICON_FOLDER;
      } else {
        thumb.innerHTML = FILES_ICON_FILE_TEXT;
        if (item.uri) {
          thumbTasks.push({
            uri: item.uri,
            cacheKey: `${item.uri}|${item.size}|${item.lastModified}`,
            thumb,
          });
        }
      }
      card.appendChild(thumb);

      // Details column
      const details = document.createElement('div');
      details.className = 'file-item-details';

      const nameEl = document.createElement('span');
      nameEl.className = 'file-item-name';
      nameEl.textContent = item.name;
      details.appendChild(nameEl);

      if (!isDir) {
        const meta = document.createElement('span');
        meta.className = 'file-item-meta';
        const dateStr = new Date(item.lastModified).toLocaleDateString(getLanguage() === 'tr' ? 'tr-TR' : 'en-US', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        meta.textContent = `${formatBytes(item.size)} • ${dateStr}`;
        details.appendChild(meta);
      } else {
        const meta = document.createElement('span');
        meta.className = 'file-item-meta';
        meta.textContent = t('common.folder');
        details.appendChild(meta);
      }

      card.appendChild(details);

      // Actions: single overflow menu (Taşı / Yeniden Adlandır / Paylaş / Sil)
      const actions = document.createElement('div');
      actions.className = 'file-item-actions';

      const moreBtn = document.createElement('button');
      moreBtn.className = 'icon-btn-sm';
      moreBtn.innerHTML = FILES_ICON_ELLIPSIS;
      moreBtn.ariaLabel = t('common.moreActions');
      moreBtn.title = t('common.moreActions');
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFileActionsModal(item, isDir);
      });
      actions.appendChild(moreBtn);

      card.appendChild(actions);

      // Card click: navigate into folder or open PDF
      card.addEventListener('click', async () => {
        if (isDir) {
          currentFolderPath = currentFolderPath ? `${currentFolderPath}/${item.name}` : item.name;
          void renderFilesList();
        } else {
          try {
            const picked = await readPdfFromUri(item.uri);
            await openReaderWithBytes(picked.bytes, picked.name, item.uri, 'files');
          } catch {
            showToast(t('toast.fileOpenError'));
          }
        }
      });

      filesList.appendChild(card);
    }

    applyFilesSearchFilter();

    // Sequential async fill of real thumbnails; abandoned as soon as a newer
    // render bumps the generation counter.
    void (async () => {
      for (const task of thumbTasks) {
        if (generation !== filesRenderGeneration) return;
        const dataUrl = await getPdfThumbnail(task.uri, task.cacheKey);
        if (generation !== filesRenderGeneration) return;
        if (dataUrl) {
          const img = document.createElement('img');
          img.className = 'file-item-thumb-img';
          img.alt = '';
          img.src = dataUrl;
          task.thumb.replaceChildren(img);
        }
      }
    })();
  }

  /** Marks one folder row as the selected move target. */
  function selectMoveFolderRow(btn: HTMLButtonElement, path: string): void {
    moveDocFolderList.querySelectorAll('.folder-select-item').forEach((b) =>
      b.classList.remove('is-selected'),
    );
    btn.classList.add('is-selected');
    moveTargetFolder = path;
    moveDocConfirmBtn.disabled = false;
  }

  /** Builds one expandable folder row for the Move modal; subfolders are lazy-loaded on first expand. */
  function buildMoveFolderRow(path: string, name: string, depth: number): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'folder-tree-item';

    const header = document.createElement('div');
    header.className = 'folder-tree-row-header';
    header.style.paddingLeft = `${(depth - 1) * 16}px`;
    item.appendChild(header);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'folder-tree-toggle';
    toggleBtn.textContent = '▸';
    toggleBtn.ariaLabel = t('files.showSubfoldersOf', { name });
    header.appendChild(toggleBtn);

    const selectBtn = document.createElement('button');
    selectBtn.className = 'folder-select-item';
    selectBtn.textContent = `📁 ${name}`;
    selectBtn.dataset.path = path;
    selectBtn.addEventListener('click', () => selectMoveFolderRow(selectBtn, path));
    header.appendChild(selectBtn);

    const childrenEl = document.createElement('div');
    childrenEl.className = 'folder-tree-children hidden';
    item.appendChild(childrenEl);

    let loaded = false;
    let expanded = false;
    toggleBtn.addEventListener('click', async () => {
      expanded = !expanded;
      toggleBtn.textContent = expanded ? '▾' : '▸';
      childrenEl.classList.toggle('hidden', !expanded);
      if (expanded && !loaded) {
        loaded = true;
        try {
          const sub = await listPrivateFolder(path);
          const subFolders = sub.filter((s) => s.type === 'directory');
          if (subFolders.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'folder-tree-empty';
            empty.textContent = t('files.noSubfolders');
            childrenEl.appendChild(empty);
          } else {
            for (const s of subFolders) {
              childrenEl.appendChild(buildMoveFolderRow(`${path}/${s.name}`, s.name, depth + 1));
            }
          }
        } catch {
          // ignore
        }
      }
    });

    return item;
  }

  /** Renders the folder list inside the Move modal as a lazily-expandable tree (any depth, not just two levels). */
  async function renderMoveFolderList(): Promise<void> {
    moveDocFolderList.innerHTML = '';

    const rootBtn = document.createElement('button');
    rootBtn.className = 'folder-select-item';
    rootBtn.textContent = t('files.root');
    rootBtn.dataset.path = '';
    rootBtn.addEventListener('click', () => selectMoveFolderRow(rootBtn, ''));
    moveDocFolderList.appendChild(rootBtn);

    const topLevel = await listPrivateFolder('');
    for (const item of topLevel) {
      if (item.type === 'directory') {
        moveDocFolderList.appendChild(buildMoveFolderRow(item.name, item.name, 1));
      }
    }
  }

  // --- Toolbar event listeners ---
  filesNewFolderBtn.addEventListener('click', async () => {
    const name = prompt(t('common.newFolderPrompt'));
    if (!name || !name.trim()) return;
    const safeName = name.trim().replace(/[/\\:*?"<>|]/g, '_');
    const newPath = currentFolderPath ? `${currentFolderPath}/${safeName}` : safeName;
    try {
      await createPrivateDirectory(newPath);
      showToast(t('toast.folderCreated', { name: safeName }));
      void renderFilesList();
    } catch {
      showToast(t('toast.folderCreateError'));
    }
  });

  filesSortBtn.addEventListener('click', () => {
    filesSortRows.forEach((row) => {
      row.classList.toggle('is-selected', row.dataset.sort === filesSortMode);
    });
    filesSortSheet.classList.remove('hidden');
  });

  filesSortBackdrop.addEventListener('click', () => {
    filesSortSheet.classList.add('hidden');
  });

  filesSortRows.forEach((row) => {
    row.addEventListener('click', () => {
      filesSortMode = (row.dataset.sort as FileSortMode) ?? 'date-desc';
      localStorage.setItem('bindery.filesSort', filesSortMode);
      filesSortSheet.classList.add('hidden');
      void renderFilesList();
    });
  });

  filesSearchInput.addEventListener('input', applyFilesSearchFilter);

  filesDownloadBtn.addEventListener('click', () => {
    showToast(t('toast.openingDownloadModal'));
    downloadPdfUrlInput.value = '';
    downloadPdfNameInput.value = '';
    downloadPdfConfirmBtn.disabled = false;
    downloadPdfConfirmBtnLabel.classList.remove('hidden');
    downloadPdfSpinner.classList.add('hidden');
    openModal(downloadPdfModal, filesDownloadBtn);
  });

  downloadPdfCancelBtn.addEventListener('click', () => {
    closeModal(downloadPdfModal);
  });

  downloadPdfConfirmBtn.addEventListener('click', async () => {
    const url = downloadPdfUrlInput.value.trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      showToast(t('toast.invalidUrl'));
      return;
    }

    let filename = downloadPdfNameInput.value.trim();
    if (!filename) {
      try {
        const parsedUrl = new URL(url);
        const urlName = parsedUrl.pathname.split('/').pop();
        filename = urlName ? decodeURIComponent(urlName) : 'downloaded_document';
      } catch {
        filename = 'downloaded_document';
      }
    }

    filename = filename.replace(/[/\\:*?"<>|]/g, '_');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }

    const targetPath = `downloads/${filename}`;
    if (await pathExists(targetPath)) {
      const overwrite = await showConfirmDialog(t('common.overwriteConfirm', { name: filename }));
      if (!overwrite) return;
    }

    downloadPdfConfirmBtn.disabled = true;
    downloadPdfConfirmBtnLabel.classList.add('hidden');
    downloadPdfSpinner.classList.remove('hidden');

    try {
      const bytes = await downloadPdfFromUrl(url);
      const savedUri = await savePdfPrivately(bytes, targetPath);
      await recordOpened({ uri: savedUri, name: filename });
      
      showToast(t('toast.downloadSuccess'));
      closeModal(downloadPdfModal);
      
      // Auto-open in reader
      await openReaderWithBytes(bytes, filename, savedUri, 'files');
      void renderFilesList();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t('toast.downloadFailed', { message }));
    } finally {
      downloadPdfConfirmBtn.disabled = false;
      downloadPdfConfirmBtnLabel.classList.remove('hidden');
      downloadPdfSpinner.classList.add('hidden');
    }
  });

  // --- File actions modal event listener ---
  fileActionsCancelBtn.addEventListener('click', () => {
    closeModal(fileActionsModal);
  });

  // --- Open in tool sheet event listeners ---
  openInToolCancelBtn.addEventListener('click', () => {
    closeModal(openInToolSheet);
  });

  openInToolList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tool-id]');
    if (!btn || !openInToolUri) return;
    const toolId = btn.dataset.toolId!;
    closeModal(openInToolSheet);
    void openFileInTool(toolId, openInToolUri);
  });

  // --- Move modal event listeners ---
  moveDocCancelBtn.addEventListener('click', () => {
    closeModal(moveDocModal);
    moveSourceFile = null;
    moveTargetFolder = null;
  });

  moveDocConfirmBtn.addEventListener('click', async () => {
    if (!moveSourceFile || moveTargetFolder === null) return;
    moveDocConfirmBtn.disabled = true;
    try {
      const sourceDir = currentFolderPath ? `${currentFolderPath}/${moveSourceFile.name}` : moveSourceFile.name;
      const destDir = moveTargetFolder ? `${moveTargetFolder}/${moveSourceFile.name}` : moveSourceFile.name;

      if (sourceDir === destDir) {
        showToast(t('toast.sourceTargetSame'));
        closeModal(moveDocModal);
        return;
      }

      const newUri = await movePrivateItem(sourceDir, destDir);
      // Update recents with new URI
      try {
        await removeRecent(moveSourceFile.name);
        await recordOpened({ uri: newUri, name: moveSourceFile.name });
      } catch {
        // not in recents, ignore
      }
      showToast(t('toast.moved', { name: moveSourceFile.name }));
      closeModal(moveDocModal);
      moveSourceFile = null;
      moveTargetFolder = null;
      void renderFilesList();
    } catch {
      showToast(t('toast.moveError'));
    } finally {
      moveDocConfirmBtn.disabled = false;
    }
  });


  // Dark mode init
  function applyThemePreference(active: boolean): void {
    document.documentElement.classList.toggle('dark-theme', active);
    document.documentElement.classList.toggle('light-theme', !active);
  }

  const isDarkMode = localStorage.getItem('bindery.darkmode') === 'true';
  settingsDarkModeToggle.checked = isDarkMode;
  applyThemePreference(isDarkMode);

  settingsDarkModeToggle.addEventListener('change', () => {
    const active = settingsDarkModeToggle.checked;
    localStorage.setItem('bindery.darkmode', String(active));
    applyThemePreference(active);
  });

  function syncSettingsLangButtons(): void {
    settingsLangBtns.forEach((b) => b.classList.toggle('is-selected', b.dataset.lang === getLanguage()));
  }

  function refreshTopBarTitle(): void {
    const current = getCurrentScreenId();
    if (current !== 'reader') {
      topBarTitle.textContent = t(SCREEN_TITLES[current]);
    }
  }

  syncSettingsLangButtons();

  settingsLangBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      applyLanguageChange(btn.dataset.lang === 'tr' ? 'tr' : 'en');
    });
  });

  // First-launch onboarding
  const ONBOARDING_PAGE_COUNT = 3;
  let onboardingIndex = 0;
  let onboardingTouchStartX = 0;
  let onboardingTouchStartY = 0;

  function renderOnboarding(): void {
    onboardingTrack.style.transform = `translateX(-${onboardingIndex * (100 / ONBOARDING_PAGE_COUNT)}%)`;
    Array.from(onboardingDots.querySelectorAll<HTMLSpanElement>('.onboarding-dot')).forEach((dot, i) => {
      dot.classList.toggle('is-active', i === onboardingIndex);
    });
    onboardingNextBtn.textContent = onboardingIndex === ONBOARDING_PAGE_COUNT - 1 ? t('onboarding.start') : t('onboarding.next');
  }

  function syncOnboardingLangButtons(): void {
    onboardingLangBtns.forEach((b) => b.classList.toggle('is-selected', b.dataset.lang === getLanguage()));
  }

  function applyLanguageChange(lang: Lang): void {
    setLanguage(lang);
    syncOnboardingLangButtons();
    syncSettingsLangButtons();
    renderOnboarding();
    refreshTopBarTitle();
    // The save-button label and config summary are built dynamically (count /
    // state), so re-apply them after the static data-i18n pass.
    refreshSaveLabel();
    updateCoverAvailability();
    refreshConfigSummary();
  }

  function startOnboarding(): void {
    onboardingIndex = 0;
    syncOnboardingLangButtons();
    renderOnboarding();
    onboardingOverlay.classList.remove('hidden');
  }

  function finishOnboarding(): void {
    localStorage.setItem('bindery.onboarded', 'true');
    onboardingOverlay.classList.add('hidden');
    // hub is now actually visible for the first time → play the brand intro
    requestHeroIntro();
  }

  onboardingNextBtn.addEventListener('click', () => {
    if (onboardingIndex < ONBOARDING_PAGE_COUNT - 1) {
      onboardingIndex += 1;
      renderOnboarding();
    } else {
      finishOnboarding();
    }
  });

  onboardingThemeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const active = btn.dataset.theme === 'dark';
      onboardingThemeBtns.forEach((b) => b.classList.toggle('is-selected', b === btn));
      localStorage.setItem('bindery.darkmode', String(active));
      applyThemePreference(active);
      settingsDarkModeToggle.checked = active;
    });
  });

  onboardingLangBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      applyLanguageChange(btn.dataset.lang === 'tr' ? 'tr' : 'en');
    });
  });

  onboardingOverlay.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      onboardingTouchStartX = e.touches[0].clientX;
      onboardingTouchStartY = e.touches[0].clientY;
    },
    { passive: true },
  );

  onboardingOverlay.addEventListener(
    'touchend',
    (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - onboardingTouchStartX;
      const dy = touch.clientY - onboardingTouchStartY;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0 && onboardingIndex < ONBOARDING_PAGE_COUNT - 1) {
        onboardingIndex += 1;
        renderOnboarding();
      } else if (dx > 0 && onboardingIndex > 0) {
        onboardingIndex -= 1;
        renderOnboarding();
      }
    },
    { passive: true },
  );

  settingsClearCacheBtn.addEventListener('click', async () => {
    try {
      const result = await Filesystem.readdir({
        path: '',
        directory: Directory.Cache,
      });
      let failures = 0;
      for (const file of result.files) {
        try {
          if (file.type === 'directory') {
            await Filesystem.rmdir({
              path: file.name,
              directory: Directory.Cache,
              recursive: true,
            });
          } else {
            await Filesystem.deleteFile({
              path: file.name,
              directory: Directory.Cache,
            });
          }
        } catch {
          failures += 1;
        }
      }
      showToast(failures === 0 ? t('toast.cacheCleared') : t('toast.cachePartiallyCleared'));
    } catch {
      showToast(t('toast.clearCacheError'));
    }
  });

  // Check and request camera permission on startup
  void (async () => {
    try {
      const status = await Camera.checkPermissions();
      if (status.camera !== 'granted') {
        await Camera.requestPermissions({ permissions: ['camera'] });
      }
    } catch (e) {
      console.warn('Camera permission check failed on startup:', e);
    }
  })();

  showScreen('hub');

  void App.getInfo().then((info) => { appVersionValue.textContent = `v${info.version}`; }).catch(() => {});

  if (localStorage.getItem('bindery.onboarded') !== 'true') {
    startOnboarding();
  }

  setupIncomingPdfLinks((url) => {
    void (async () => {
      try {
        const picked = await readPdfFromUri(url);
        await openReaderWithBytes(picked.bytes, picked.name, url);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        goToError(t('error.pdfOpenFailed'), message, 'hub');
      }
    })();
  });
}
