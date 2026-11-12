/**
 * Browser OTA is deliberately not qualified for any current badge.
 *
 * The original runJieliOta sender did not reproduce the documented authenticated
 * RCSP framing and no real BG02 stock firmware image has been obtained.
 * Exposing a flash button for different LJ733 V1.1/V1.2 packages would permit
 * irreversible cross-SKU damage. Reading catalogue entries and downloading
 * files for offline analysis remains allowed.
 *
 * Future enabling requires an exact board/firmware identity match, authenticated
 * OTA transport qualification, image integrity, recovery path and owner approval.
 * This shared transfer-layer gate deliberately does NOT trust UI controls.
 */
export const BROWSER_OTA_FLASH_QUALIFIED = false;
export const BROWSER_OTA_BLOCK_REASON =
  'Browser firmware flashing is disabled: no compatible BG02 V1.5 firmware ' +
  'or validated authenticated RCSP updater has been qualified. ' +
  'Catalogue lookup, offline download and GATT diagnostics remain available.';

export function assertBrowserOtaFlashQualified() {
  throw new Error(BROWSER_OTA_BLOCK_REASON);
}
