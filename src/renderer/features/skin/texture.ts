// Canvas normalization fixes files with mismatched extension or MIME metadata.
export const normalizeTextureToPng = async (objectUrl: string): Promise<ArrayBuffer> => {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to decode texture image'));
    image.src = objectUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to initialize 2D canvas context');
  }

  context.drawImage(image, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blobValue) => {
      if (blobValue === null) {
        reject(new Error('PNG encoding failed'));
      } else {
        resolve(blobValue);
      }
    }, 'image/png');
  });

  return blob.arrayBuffer();
};
