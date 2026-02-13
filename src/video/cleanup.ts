import fs from 'fs';

/**
 * Recursively delete a directory and all its contents.
 * Used to clean up temp files after processing completes or fails.
 */
export function cleanupTempFiles(dirPath: string): void {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            console.log(`[Cleanup] Removed temp directory: ${dirPath}`);
        }
    } catch (error) {
        console.error(`[Cleanup] Failed to remove ${dirPath}:`, error);
    }
}
