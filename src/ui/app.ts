import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { BookletError } from '../engine/types';
import { makeBooklet } from '../engine/booklet-engine';
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
  const pdfSourceQuireBtn = byId<HTMLButtonElement>('pdfSourceQuireBtn');
  const pdfSourceDeviceBtn = byId<HTMLButtonElement>('pdfSourceDeviceBtn');
  const pdfSourceCancelBtn = byId<HTMLButtonElement>('pdfSourceCancelBtn');

  const quireFilePickerModal = byId<HTMLDivElement>('quireFilePickerModal');
  const quirePickerBreadcrumb = byId<HTMLDivElement>('quirePickerBreadcrumb');
  const quirePickerList = byId<HTMLDivElement>('quirePickerList');
  const quirePickerEmptyHint = byId<HTMLParagraphElement>('quirePickerEmptyHint');
  const quirePickerCancelBtn = byId<HTMLButtonElement>('quirePickerCancelBtn');
  const quirePickerConfirmBtn = byId<HTMLButtonElement>('quirePickerConfirmBtn');
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
  let filesSortMode: FileSortMode = (localStorage.getItem('quire.filesSort') as FileSortMode) ?? 'date-desc';
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
  const toolRows = Array.from(document.querySelectorAll<HTMLButtonElement>('.tool-row'));
  const toolCategories = Array.from(document.querySelectorAll<HTMLElement>('.tool-category'));

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
  const generateBtn = byId<HTMLButtonElement>('generateBtn');
  const generateBtnLabel = byId<HTMLSpanElement>('generateBtnLabel');
  const generateSpinner = byId<HTMLSpanElement>('generateSpinner');

  const statOriginal = byId<HTMLSpanElement>('statOriginal');
  const statPaddingCard = byId<HTMLDivElement>('statPaddingCard');
  const statPadding = byId<HTMLSpanElement>('statPadding');
  const statSheets = byId<HTMLSpanElement>('statSheets');
  const actionStatus = byId<HTMLParagraphElement>('actionStatus');
  const newFileBtn = byId<HTMLButtonElement>('newFileBtn');
  const readerOpeningOverlay = byId<HTMLDivElement>('readerOpeningOverlay');
  const frontPreviewImg = byId<HTMLImageElement>('frontPreviewImg');
  const frontPreviewSpinner = byId<HTMLDivElement>('frontPreviewSpinner');
  const frontPreviewError = byId<HTMLParagraphElement>('frontPreviewError');
  const backPreviewImg = byId<HTMLImageElement>('backPreviewImg');
  const backPreviewSpinner = byId<HTMLDivElement>('backPreviewSpinner');
  const backPreviewError = byId<HTMLParagraphElement>('backPreviewError');

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
  let booklet: { frontPdf: Uint8Array; backPdf: Uint8Array } | null = null;
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
  const recentsSection = byId<HTMLDivElement>('recentsSection');
  const recentsList = byId<HTMLDivElement>('recentsList');
  const readerPageIndicator = byId<HTMLSpanElement>('readerPageIndicator');
  const readerNightModeBtn = byId<HTMLButtonElement>('readerNightModeBtn');
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
  let readerAspectRatio = Math.SQRT2;
  let readerIndicatorRaf = 0;
  let readerLastPageSaveTimer: ReturnType<typeof setTimeout> | undefined;
  // Must match .reader-page-list's `gap` and top padding in styles.css.
  const READER_PAGE_GAP_PX = 6;
  const READER_LIST_TOP_PADDING_PX = 6;

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
    }
    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle('hidden', key !== id);
    }
    topBarTitle.textContent = t(SCREEN_TITLES[id]);

    const isTab = id === 'hub' || id === 'recents' || id === 'files' || id === 'settings';
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
      void renderRecentsList();
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
    for (const category of toolCategories) {
      let visibleCount = 0;
      category.querySelectorAll<HTMLButtonElement>('.tool-row').forEach((row) => {
        const title = row.querySelector('.tool-row-title')?.textContent?.toLowerCase() ?? '';
        const desc = row.querySelector('.tool-row-desc')?.textContent?.toLowerCase() ?? '';
        const matches = query === '' || title.includes(query) || desc.includes(query);
        row.classList.toggle('hidden', !matches);
        if (matches) visibleCount += 1;
      });
      category.classList.toggle('hidden', visibleCount === 0);
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

  let currentPickerPath = '';
  let selectedPickerFiles: { name: string; uri: string }[] = [];
  let pickerResolve: ((value: any) => void) | null = null;

  function renderQuirePickerBreadcrumb(): void {
    quirePickerBreadcrumb.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'breadcrumb-item';
    btn.textContent = t('files.root');
    btn.addEventListener('click', () => {
      currentPickerPath = '';
      void renderQuirePickerList(quirePickerConfirmBtn.classList.contains('hidden') ? false : true);
    });
    quirePickerBreadcrumb.appendChild(btn);

    if (currentPickerPath) {
      const parts = currentPickerPath.split('/');
      let pathAcc = '';
      parts.forEach((part) => {
        pathAcc = pathAcc ? `${pathAcc}/${part}` : part;
        const currentPath = pathAcc;
        const separator = document.createElement('span');
        separator.className = 'breadcrumb-separator';
        separator.textContent = ' › ';
        quirePickerBreadcrumb.appendChild(separator);

        const folderBtn = document.createElement('button');
        folderBtn.className = 'breadcrumb-item';
        folderBtn.textContent = part;
        folderBtn.addEventListener('click', () => {
          currentPickerPath = currentPath;
          void renderQuirePickerList(quirePickerConfirmBtn.classList.contains('hidden') ? false : true);
        });
        quirePickerBreadcrumb.appendChild(folderBtn);
      });
    }
  }

  async function renderQuirePickerList(allowMultiple: boolean): Promise<void> {
    renderQuirePickerBreadcrumb();
    const items = await listPrivateFolder(currentPickerPath);
    quirePickerList.innerHTML = '';

    const pdfItems = items.filter(
      (item) => item.type === 'directory' || item.name.toLowerCase().endsWith('.pdf')
    );
    const isEmpty = pdfItems.length === 0;
    quirePickerEmptyHint.classList.toggle('hidden', !isEmpty);

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
          void renderQuirePickerList(allowMultiple);
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
            quirePickerConfirmBtn.disabled = selectedPickerFiles.length === 0;
          } else {
            closeModal(quireFilePickerModal);
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

      quirePickerList.appendChild(card);
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

      const handleQuire = () => {
        closeModal(pdfSourceModal);
        cleanupSourceListeners();

        currentPickerPath = '';
        selectedPickerFiles = [];

        openModal(quireFilePickerModal);
        if (options.allowMultiple) {
          quirePickerConfirmBtn.classList.remove('hidden');
          quirePickerConfirmBtn.disabled = true;
        } else {
          quirePickerConfirmBtn.classList.add('hidden');
        }

        void renderQuirePickerList(options.allowMultiple);
      };

      const handleCancel = () => {
        closeModal(pdfSourceModal);
        cleanupSourceListeners();
        resolve(options.allowMultiple ? [] : null);
      };

      const cleanupSourceListeners = () => {
        pdfSourceDeviceBtn.removeEventListener('click', handleDevice);
        pdfSourceQuireBtn.removeEventListener('click', handleQuire);
        pdfSourceCancelBtn.removeEventListener('click', handleCancel);
      };

      pdfSourceDeviceBtn.addEventListener('click', handleDevice);
      pdfSourceQuireBtn.addEventListener('click', handleQuire);
      pdfSourceCancelBtn.addEventListener('click', handleCancel);

      openModal(pdfSourceModal);
    });
  }

  quirePickerCancelBtn.addEventListener('click', () => {
    closeModal(quireFilePickerModal);
    pickerResolve?.(quirePickerConfirmBtn.classList.contains('hidden') ? null : []);
  });

  quirePickerConfirmBtn.addEventListener('click', async () => {
    closeModal(quireFilePickerModal);
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

  continueBtn.addEventListener('click', () => showScreen('config'));

  gutterSlider.addEventListener('input', () => {
    gutterValueLabel.textContent = `${gutterSlider.value} pt`;
  });

  creepSlider.addEventListener('input', () => {
    creepValueLabel.textContent = `${Number(creepSlider.value).toFixed(1)} pt`;
  });

  generateBtn.addEventListener('click', async () => {
    if (!selectedFile) {
      showScreen('picker');
      return;
    }

    generateBtn.disabled = true;
    generateBtnLabel.classList.add('hidden');
    generateSpinner.classList.remove('hidden');

    try {
      const result = await makeBooklet(selectedFile.bytes, {
        gutter: Number(gutterSlider.value),
        creep: Number(creepSlider.value),
      });

      booklet = { frontPdf: result.frontPdf, backPdf: result.backPdf };

      statOriginal.textContent = String(result.originalPages);
      statSheets.textContent = String(result.sheetsCount);
      if (result.paddingApplied > 0) {
        statPadding.textContent = `+${result.paddingApplied}`;
        statPaddingCard.classList.remove('hidden');
      } else {
        statPaddingCard.classList.add('hidden');
      }
      actionStatus.textContent = '';

      showScreen('result');
      void renderBookletPreviews(result.frontPdf, result.backPdf);
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

  async function renderBookletPreviews(frontBytes: Uint8Array, backBytes: Uint8Array): Promise<void> {
    async function renderOne(
      bytes: Uint8Array,
      imgEl: HTMLImageElement,
      spinnerEl: HTMLDivElement,
    ): Promise<void> {
      const proxy = await loadPdfForThumbnails(bytes.slice());
      try {
        const dataUrl = await renderPageThumbnail(proxy, 1, 160);
        imgEl.src = dataUrl;
        imgEl.classList.remove('hidden');
      } finally {
        await destroyThumbnailDoc(proxy);
        spinnerEl.classList.add('hidden');
      }
    }

    const results = await Promise.allSettled([
      renderOne(frontBytes, frontPreviewImg, frontPreviewSpinner),
      renderOne(backBytes,  backPreviewImg,  backPreviewSpinner),
    ]);
    if (results[0].status === 'rejected') {
      frontPreviewSpinner.classList.add('hidden');
      frontPreviewError.classList.remove('hidden');
    }
    if (results[1].status === 'rejected') {
      backPreviewSpinner.classList.add('hidden');
      backPreviewError.classList.remove('hidden');
    }
  }

  document.querySelectorAll<HTMLButtonElement>('[data-target][data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!booklet) return;
      const target = button.dataset.target as 'front' | 'back';
      const action = button.dataset.action as 'save' | 'share';
      const bytes = target === 'front' ? booklet.frontPdf : booklet.backPdf;
      const filename = `${selectedFile?.name.replace(/\.pdf$/i, '') ?? 'booklet'}_${target}.pdf`;
      const label = target === 'front' ? t('booklet.frontSideLower') : t('booklet.backSideLower');

      try {
        if (action === 'save') {
          const savedUri = await savePdfPrivately(bytes, `booklets/${filename}`);
          await recordOpened({ uri: savedUri, name: filename });
          actionStatus.textContent = t('status.booklet.savedToQuire', { label });
        } else {
          await sharePdf(bytes, filename, `${label} PDF`);
          actionStatus.textContent = t('status.booklet.shared', { label });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actionStatus.textContent = t('status.booklet.actionFailed', { label, message });
      }
    });
  });

  newFileBtn.addEventListener('click', async () => {
    if (booklet !== null) {
      if (!(await showConfirmDialog(t('confirm.discardResult')))) return;
    }
    resetPicker();
    booklet = null;
    frontPreviewImg.classList.add('hidden');
    frontPreviewImg.src = '';
    frontPreviewError.classList.add('hidden');
    frontPreviewSpinner.classList.remove('hidden');
    backPreviewImg.classList.add('hidden');
    backPreviewImg.src = '';
    backPreviewError.classList.add('hidden');
    backPreviewSpinner.classList.remove('hidden');
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

  function setActiveSegment(group: HTMLElement, dataKey: 'position' | 'format' | 'mode' | 'rotate', value: string): void {
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

      // Auto-save privately inside Quire data folder
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

  window.addEventListener('resize', () => {
    if (getCurrentScreenId() === 'crop') {
      updateCropUI();
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
    if (readerDoc) {
      const doc = readerDoc;
      readerDoc = null;
      await doc.destroy();
    }
  }

  function readerSlotHeight(): number {
    return readerBaseWidthPx * readerAspectRatio + READER_PAGE_GAP_PX;
  }

  function updateReaderPageIndicator(): void {
    if (!readerDoc) return;
    const slot = readerSlotHeight();
    const offset = Math.max(0, readerScroll.scrollTop - READER_LIST_TOP_PADDING_PX);
    const current = slot > 0 ? Math.min(readerDoc.proxy.numPages, Math.floor(offset / slot) + 1) : 1;
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

  async function renderReaderPageInto(container: HTMLDivElement, pageNumber: number): Promise<void> {
    if (!readerDoc) return;
    try {
      const { wrapper, canvas } = await renderReaderPage(readerDoc.proxy, pageNumber, readerBaseWidthPx, readerNightMode);
      if (!readerDoc || !document.contains(container)) return;
      container.innerHTML = '';
      // Container size is always driven by applyReaderPageSize, never by
      // the canvas — the canvas just fits inside it (.reader-page canvas
      // has max-width/max-height: 100%). This keeps layout/scroll math
      // (readerSlotHeight) exact and decoupled from per-page render
      // precision, so re-rendering a page for sharpness can never itself
      // shift the scroll position.
      container.appendChild(wrapper);
      readerRendered.set(pageNumber, canvas);
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
    const firstPage = await readerDoc.proxy.getPage(1);
    const baseViewport = firstPage.getViewport({ scale: 1 });
    readerAspectRatio = baseViewport.height / baseViewport.width;
    readerBaseWidthPx = Math.min(window.innerWidth, 1000);

    readerPageList.innerHTML = '';
    readerRendered.clear();

    const pageHeight = readerBaseWidthPx * readerAspectRatio;
    readerPageList.style.setProperty('--reader-page-width', `${readerBaseWidthPx}px`);
    readerPageList.style.setProperty('--reader-page-height', `${pageHeight}px`);

    readerObserver = new IntersectionObserver(
      (entries) => {
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
      readerObserver.observe(placeholder);
    }

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
        readerScroll.scrollTop = (initialPage - 1) * readerSlotHeight() + READER_LIST_TOP_PADDING_PX;
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

  async function renderRecentsList(): Promise<void> {
    const recents = await getRecents();
    recentsSection.classList.toggle('hidden', recents.length === 0);
    recentsList.innerHTML = '';
    for (const entry of recents) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'recents-row';

      const meta = document.createElement('span');
      meta.className = 'recents-row-meta';
      const nameEl = document.createElement('span');
      nameEl.className = 'recents-row-name';
      nameEl.textContent = entry.name;
      const pageEl = document.createElement('span');
      pageEl.className = 'recents-row-page';
      pageEl.textContent = t('common.pageLabel', { n: entry.lastPage });
      meta.append(nameEl, pageEl);
      row.appendChild(meta);

      row.addEventListener('click', () => void openRecent(entry));
      recentsList.appendChild(row);
    }
  }

  async function openRecent(entry: RecentEntry): Promise<void> {
    if (!entry.uri) {
      showToast(t('toast.fileNoLongerAccessible'));
      await removeRecent(entry.name);
      await renderRecentsList();
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
      await renderRecentsList();
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
    const slot = readerSlotHeight();
    const targetScrollTop = (pageNumber - 1) * slot + READER_LIST_TOP_PADDING_PX;
    readerScroll.scrollTo({ top: targetScrollTop, behavior: 'smooth' });

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
    const slot = readerSlotHeight();
    const offset = Math.max(0, readerScroll.scrollTop - READER_LIST_TOP_PADDING_PX);
    fullscreenCurrentPage = slot > 0 ? Math.min(readerDoc.proxy.numPages, Math.floor(offset / slot) + 1) : 1;

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
      const slot = readerSlotHeight();
      readerScroll.scrollTop = (fullscreenCurrentPage - 1) * slot + READER_LIST_TOP_PADDING_PX;
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
      case 'result': return booklet !== null;
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
        showToast(t('toast.savedToQuire'));
      } else {
        const publicUri = await savePdfToDevice(readerBytes, newName);
        
        readerName = newName;
        readerUri = publicUri;
        topBarTitle.textContent = readerName;
        
        await recordOpened({ uri: publicUri, name: newName });
        showToast(t('toast.savedToDevice'));
      }
      
      closeModal(saveDocModal);
      void renderRecentsList();
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
    if (current === 'hub' || current === 'recents' || current === 'files' || current === 'settings') {
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

  async function renderFilesList(): Promise<void> {
    renderFilesBreadcrumb();

    let raw: Awaited<ReturnType<typeof listPrivateFolder>>;
    try {
      raw = await listPrivateFolder(currentFolderPath);
    } catch {
      showToast(t('files.loadError'));
      return;
    }
    const items = sortFileEntries(raw, filesSortMode);
    const isEmpty = items.length === 0;
    filesEmptyHint.classList.toggle('hidden', !isEmpty);
    filesList.innerHTML = '';

    for (const item of items) {
      const isDir = item.type === 'directory';

      const card = document.createElement('div');
      card.className = 'file-item-card';
      if (isDir) card.classList.add('is-folder');

      // Icon
      const icon = document.createElement('span');
      icon.className = 'file-item-icon';
      icon.textContent = isDir ? '📂' : '📄';
      icon.ariaHidden = 'true';
      card.appendChild(icon);

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
      moreBtn.textContent = '⋮';
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
      localStorage.setItem('quire.filesSort', filesSortMode);
      filesSortSheet.classList.add('hidden');
      void renderFilesList();
    });
  });

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

  const isDarkMode = localStorage.getItem('quire.darkmode') === 'true';
  settingsDarkModeToggle.checked = isDarkMode;
  applyThemePreference(isDarkMode);

  settingsDarkModeToggle.addEventListener('change', () => {
    const active = settingsDarkModeToggle.checked;
    localStorage.setItem('quire.darkmode', String(active));
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
  }

  function startOnboarding(): void {
    onboardingIndex = 0;
    syncOnboardingLangButtons();
    renderOnboarding();
    onboardingOverlay.classList.remove('hidden');
  }

  function finishOnboarding(): void {
    localStorage.setItem('quire.onboarded', 'true');
    onboardingOverlay.classList.add('hidden');
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
      localStorage.setItem('quire.darkmode', String(active));
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

  if (localStorage.getItem('quire.onboarded') !== 'true') {
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
