import { Storage } from '@google-cloud/storage';
import crypto from 'crypto';

/// Initialize the Storage client using default credentials
const storage = new Storage();

export const getFile = (filename: string, bucket: string) => {
  return Promise.resolve('File download:' + filename + ' - ' + bucket);
};

export const getFileUploadSignedURL = async (
  filename: string,
  sizeInBytes: number,
  bucket: string = 'Variables.publicBucket',
  path: string = '',
) => {
  // ensure trailing slash in path
  const newpath = path.length > 0 && (path[path.length-1] !== '/') ? (path + '/') : path;
  // generating random UUID so that file names are always unique
  const filenamePrefix = crypto.randomUUID().slice(0, 18);
  const newFilename = `${newpath}${filenamePrefix}---${filename}`;
  return await storage
    .bucket(bucket)
    .file(newFilename)
    .getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Math.floor(Date.now() + 60 * 60 * 1000), // 1 hour
      extensionHeaders: {
        'Content-Length': sizeInBytes,
      },
    })
    .then((val) => val[0])
    .then((lnk) => ({ url: lnk, newFilename }));
};

export const getFileDownloadSignedURL = async (
  filename: string,
  bucket: string = 'Variables.publicBucket',
  time: number = 60 * 60 * 1000, // 1 hour default
) => {
  return await storage
    .bucket(bucket)
    .file(filename)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Math.floor(Date.now() + time),
    })
    .then((val) => val[0])
    .then((lnk) => ({ url: lnk, filename }));
};

export const uploadFile = (
  filename: string,
  buffer: Buffer,
  mimetype: string,
  bucket: string = 'Variables.publicBucket',
) =>
  
  new Promise<string>((res, rej) => {
    console.log({ filename, mimetype, bufferLength: buffer.length });
    console.log('Uploading to bucket:', bucket);

    const name = crypto.randomUUID().slice(0, 18) + '---' + filename;
    const gFile = storage.bucket(bucket).file(name);
     
    const stream = gFile.createWriteStream({
      metadata: {
        contentType: mimetype,
      },
    });
    stream.on('error', () => {
      rej(new Error('Error occured while uploading file to google cloud'));
    });
    stream.end(buffer);
    stream.on('finish', () => res(name));
  });

// make a file public and return its public url
export const getPublicUrl = async (
  filename: string,
  bucket: string = 'Variables.publicBucket',
) => {
  const file = storage.bucket(bucket).file(filename);
  await file.makePublic();
  return await file.publicUrl();
};

export default storage;
