import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage.js";

const storageService = new ObjectStorageService();

export async function uploadToObjectStorage(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const uploadURL = await storageService.getObjectEntityUploadURL();
  const objectPath = storageService.normalizeObjectEntityPath(uploadURL);

  const response = await fetch(uploadURL, {
    method: "PUT",
    body: fileBuffer as any,
    headers: { "Content-Type": mimeType },
  });

  if (!response.ok) {
    throw new Error(`Failed to upload file to storage: ${response.status}`);
  }

  return objectPath;
}

export async function downloadFromObjectStorage(storageKey: string): Promise<Buffer> {
  const file = await storageService.getObjectEntityFile(storageKey);
  const [contents] = await file.download();
  return contents;
}

export async function deleteFromObjectStorage(storageKey: string): Promise<void> {
  try {
    const file = await storageService.getObjectEntityFile(storageKey);
    await file.delete();
  } catch (err) {
    console.warn("Failed to delete object from storage:", err);
  }
}
